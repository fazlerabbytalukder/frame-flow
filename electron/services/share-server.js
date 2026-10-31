const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const storage = require('./storage');
const { parseRange, contentTypeOf } = require('./media-response');

// Shareable links on the local network. Frame Studio itself hosts an exported
// video for people on the same Wi-Fi or office network: they open a private
// link in any browser, watch, and leave comments at exact seconds; the owner
// sees view counts. Nothing is uploaded anywhere. The server listens only
// while at least one link is active, and every route needs the link's
// unguessable token (plus the passcode when one is set).

const PORTS = [47820, 47821, 47822, 47823, 47824];
const MAX_SHARES = 200;
const MAX_COMMENTS = 500;
const MAX_BODY = 4096;
const VIEW_WINDOW_MS = 30 * 60 * 1000; // one view per viewer per half hour

let server = null;
let port = null;
const recentViews = new Map(); // `${token}|${ip}` -> time
const commentTimes = new Map(); // ip -> [times] (rate limit)

function sharesFile() {
  return path.join(storage.baseDir(), 'shares.json');
}

function readShares() {
  try {
    const list = storage.readJson(sharesFile());
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeShares(list) {
  storage.writeJsonAtomic(sharesFile(), list);
}

// Private IPv4 addresses first: that's what teammates on the LAN can reach.
function lanAddress() {
  const all = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) all.push(a.address);
  }
  const priv = all.find((ip) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip));
  return priv || all[0] || '127.0.0.1';
}

function shareUrl(share, host = lanAddress()) {
  return port ? `http://${host}:${port}/v/${share.token}` : null;
}

function publicShare(s) {
  return {
    id: s.id,
    projectId: s.projectId,
    title: s.title,
    createdAt: s.createdAt,
    views: s.views,
    showViews: s.showViews,
    hasPasscode: Boolean(s.passcode),
    comments: s.comments,
    url: shareUrl(s),
    fileName: path.basename(s.file),
    missing: !fs.existsSync(s.file),
  };
}

function listShares() {
  return readShares().map(publicShare);
}

function cleanText(v, max) {
  return String(v ?? '')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max);
}

// absFile must already be validated as one of the project's exports.
async function createShare(projectId, absFile, { title, passcode, showViews } = {}) {
  storage.assertProjectId(projectId);
  const list = readShares();
  if (list.length >= MAX_SHARES) throw new Error('Too many share links. Stop some first.');
  const code = cleanText(passcode, 32);
  const share = {
    id: crypto.randomUUID(),
    token: crypto.randomBytes(18).toString('base64url'),
    projectId,
    file: absFile,
    title: cleanText(title, 120) || 'Screen recording',
    passcode: code || null,
    showViews: showViews !== false,
    createdAt: new Date().toISOString(),
    views: 0,
    comments: [],
  };
  list.push(share);
  writeShares(list);
  await ensureServer();
  return publicShare(share);
}

async function stopShare(id) {
  const list = readShares().filter((s) => s.id !== id);
  writeShares(list);
  if (list.length === 0) await stopServer();
  return list.map(publicShare);
}

function removeComment(shareId, commentId) {
  const list = readShares();
  const share = list.find((s) => s.id === shareId);
  if (share) share.comments = share.comments.filter((c) => c.id !== commentId);
  writeShares(list);
  return share ? publicShare(share) : null;
}

// --- HTTP ---------------------------------------------------------------

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cache-Control': 'no-store',
};

function send(res, status, body, type = 'text/plain; charset=utf-8', extra = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': type, ...extra });
  res.end(body);
}

function sendJson(res, status, data) {
  send(res, status, JSON.stringify(data), 'application/json; charset=utf-8');
}

function timingSafeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function findShare(token) {
  if (!/^[A-Za-z0-9_-]{24}$/.test(token)) return null;
  const list = readShares();
  const share = list.find((s) => timingSafeEqual(s.token, token));
  return share ? { list, share } : null;
}

function passcodeOk(share, url) {
  return !share.passcode || timingSafeEqual(url.searchParams.get('k') || '', share.passcode);
}

function serveVideo(req, res, file) {
  if (!fs.existsSync(file)) return send(res, 404, 'Video not found');
  const size = fs.statSync(file).size;
  const headers = { ...SECURITY_HEADERS, 'Content-Type': contentTypeOf(file), 'Accept-Ranges': 'bytes' };
  const range = parseRange(req.headers.range, size);
  if (range === 'unsatisfiable') {
    res.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}` });
    return res.end();
  }
  const { start, end } = range || { start: 0, end: size - 1 };
  headers['Content-Length'] = String(size === 0 ? 0 : end - start + 1);
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  res.writeHead(range ? 206 : 200, headers);
  if (req.method === 'HEAD' || size === 0) return res.end();
  fs.createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (d) => {
      size += d.length;
      if (size > MAX_BODY) {
        reject(new Error('too large'));
        req.destroy();
      } else chunks.push(d);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function rateLimited(ip) {
  const now = Date.now();
  const times = (commentTimes.get(ip) || []).filter((t) => now - t < 60_000);
  if (times.length >= 10) return true;
  times.push(now);
  commentTimes.set(ip, times);
  return false;
}

function viewerComments(share) {
  return share.comments.map(({ id, t, name, text, at }) => ({ id, t, name, text, at }));
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://local');
  const m = /^\/v\/([A-Za-z0-9_-]+)(\/video|\/comments|\/info)?$/.exec(url.pathname);
  if (!m) return send(res, 404, 'Not found');
  const found = findShare(m[1]);
  if (!found) return send(res, 404, 'This link has been stopped or does not exist.');
  const { list, share } = found;
  const route = m[2] || '';
  const ip = req.socket.remoteAddress || '';

  if (route === '' && req.method === 'GET') {
    return send(res, 200, sharePage(share), 'text/html; charset=utf-8', {
      'Content-Security-Policy': "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; media-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'",
    });
  }
  if (!passcodeOk(share, url)) return sendJson(res, 403, { error: 'passcode' });

  if (route === '/info' && req.method === 'GET') {
    // Counted when the video page unlocks, once per viewer per half hour.
    const key = `${share.token}|${ip}`;
    const now = Date.now();
    if (!recentViews.has(key) || now - recentViews.get(key) > VIEW_WINDOW_MS) {
      recentViews.set(key, now);
      share.views += 1;
      writeShares(list);
    }
    return sendJson(res, 200, { title: share.title, views: share.showViews ? share.views : null, comments: viewerComments(share) });
  }
  if (route === '/video' && (req.method === 'GET' || req.method === 'HEAD')) return serveVideo(req, res, share.file);
  if (route === '/comments' && req.method === 'GET') return sendJson(res, 200, viewerComments(share));
  if (route === '/comments' && req.method === 'POST') {
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) return sendJson(res, 415, { error: 'json only' });
    if (rateLimited(ip)) return sendJson(res, 429, { error: 'Too many comments, try again in a minute.' });
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return sendJson(res, 400, { error: 'Invalid comment' });
    }
    const text = cleanText(body && body.text, 1000);
    const t = Number(body && body.t);
    if (!text || !Number.isFinite(t) || t < 0 || t > 24 * 3600) return sendJson(res, 400, { error: 'Invalid comment' });
    if (share.comments.length >= MAX_COMMENTS) return sendJson(res, 400, { error: 'This video has too many comments.' });
    share.comments.push({ id: crypto.randomUUID(), t: Math.round(t * 10) / 10, name: cleanText(body.name, 60) || 'Guest', text, at: new Date().toISOString() });
    share.comments.sort((a, b) => a.t - b.t);
    writeShares(list);
    return sendJson(res, 201, viewerComments(share));
  }
  return send(res, 405, 'Method not allowed');
}

function listen(srv, p, host) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      srv.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      srv.off('error', onError);
      resolve(srv.address().port);
    };
    srv.once('error', onError);
    srv.once('listening', onListening);
    srv.listen(p, host);
  });
}

// host: '0.0.0.0' (the network) normally; tests pass '127.0.0.1'.
async function ensureServer(host = '0.0.0.0') {
  if (server) return port;
  const srv = http.createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) send(res, 500, 'Something went wrong');
      else res.destroy();
    });
  });
  srv.requestTimeout = 30_000;
  for (const p of [...PORTS, 0]) {
    try {
      port = await listen(srv, p, host);
      server = srv;
      return port;
    } catch (err) {
      if (err.code !== 'EADDRINUSE' && err.code !== 'EACCES') throw err;
    }
  }
  throw new Error('Could not start sharing');
}

function stopServer() {
  return new Promise((resolve) => {
    if (!server) return resolve();
    const srv = server;
    server = null;
    port = null;
    srv.close(() => resolve());
    srv.closeAllConnections?.();
  });
}

// On app start: serve links that were active when the app last quit.
async function resumeSharing() {
  if (readShares().length > 0) await ensureServer();
}

function status() {
  return { running: Boolean(server), port, address: lanAddress() };
}

// --- viewer page ----------------------------------------------------------

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function sharePage(share) {
  const title = escapeHtml(share.title);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
:root{--bg:#161616;--panel:#1f1f1f;--line:#333;--text:#f1f1f1;--dim:#9a9a9a;--accent:#2680eb}
@media (prefers-color-scheme: light){:root{--bg:#f4f4f4;--panel:#fff;--line:#ddd;--text:#1d1d1d;--dim:#666}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 "Segoe UI",system-ui,sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px}h1{font-size:20px;margin:0 0 4px}.meta{color:var(--dim);font-size:12.5px;margin-bottom:14px}
.player{position:relative;background:#000;border-radius:10px;overflow:hidden}video{display:block;width:100%;max-height:72vh;background:#000}
.marks{position:relative;height:14px;margin:6px 2px 0}.mark{position:absolute;top:2px;width:10px;height:10px;margin-left:-5px;border-radius:50%;background:var(--accent);border:2px solid var(--bg);cursor:pointer}
.grid{display:grid;grid-template-columns:1fr;gap:16px;margin-top:16px}@media(min-width:860px){.grid{grid-template-columns:1fr 340px}}
section{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px}h2{font-size:13px;margin:0 0 10px;text-transform:uppercase;letter-spacing:.06em;color:var(--dim)}
.c{padding:8px 0;border-top:1px solid var(--line)}.c:first-of-type{border-top:0}.c b{font-weight:600}.time{color:var(--accent);background:none;border:0;padding:0;font:inherit;cursor:pointer;margin-right:6px}
.c p{margin:2px 0 0;white-space:pre-wrap;word-wrap:break-word}input,textarea{width:100%;background:var(--bg);color:var(--text);border:1px solid var(--line);border-radius:6px;padding:8px;font:inherit;margin-bottom:8px}
textarea{min-height:70px;resize:vertical}button.send{background:var(--accent);color:#fff;border:0;border-radius:6px;padding:8px 14px;font:inherit;font-weight:600;cursor:pointer}
.hint{color:var(--dim);font-size:12px}.err{color:#e5484d;font-size:12.5px;min-height:1em}.lock{max-width:340px;margin:12vh auto;text-align:center}
</style></head><body><main>
<div id="lock" class="lock" hidden><h1>${title}</h1><p class="hint">This video needs a passcode.</p><input id="code" type="password" placeholder="Passcode" autocomplete="off"><button class="send" id="unlock">Watch</button><p class="err" id="lockErr"></p></div>
<div id="app" hidden>
<h1>${title}</h1><div class="meta" id="meta">Shared from Frame Studio on your network</div>
<div class="player"><video id="v" controls playsinline preload="metadata"></video></div><div class="marks" id="marks"></div>
<div class="grid"><div></div><section><h2>Comments</h2><div id="list"><p class="hint">No comments yet. Pause where you mean and say what you think.</p></div>
<form id="f" style="margin-top:12px"><input id="name" maxlength="60" placeholder="Your name"><textarea id="text" maxlength="1000" placeholder="Comment at the current time…" required></textarea>
<div style="display:flex;align-items:center;gap:10px"><button class="send" type="submit">Comment at <span id="at">0:00</span></button></div><p class="err" id="err"></p></form></section></div>
</div>
<script>
(function(){
var base=location.pathname, key=new URLSearchParams(location.search).get('k')||'';
var v=document.getElementById('v'), list=document.getElementById('list'), marks=document.getElementById('marks');
function q(){return key?'?k='+encodeURIComponent(key):''}
function fmt(t){t=Math.max(0,Math.floor(t));return Math.floor(t/60)+':'+String(t%60).padStart(2,'0')}
function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e}
function render(cs){list.textContent='';marks.textContent='';
 if(!cs.length){list.appendChild(el('p','hint','No comments yet. Pause where you mean and say what you think.'))}
 cs.forEach(function(c){var row=el('div','c');var b=el('button','time',fmt(c.t));b.type='button';b.onclick=function(){v.currentTime=c.t;v.play()};
  row.appendChild(b);row.appendChild(el('b',null,c.name));row.appendChild(el('p',null,c.text));list.appendChild(row);
  if(v.duration){var m=el('span','mark');m.style.left=(c.t/v.duration*100)+'%';m.title=c.name+': '+c.text;m.onclick=function(){v.currentTime=c.t};marks.appendChild(m)}});}
var last=[];
function start(info){document.getElementById('lock').hidden=true;document.getElementById('app').hidden=false;
 if(info.views!=null)document.getElementById('meta').textContent=info.views+(info.views===1?' view':' views')+' · shared from Frame Studio on your network';
 last=info.comments;v.src=base+'/video'+q();v.addEventListener('loadedmetadata',function(){render(last)});render(last);
 setInterval(function(){fetch(base+'/comments'+q()).then(function(r){return r.ok?r.json():null}).then(function(cs){if(cs&&cs.length!==last.length){last=cs;render(cs)}}).catch(function(){})},10000)}
function load(){fetch(base+'/info'+q()).then(function(r){if(r.status===403){document.getElementById('lock').hidden=false;if(key)document.getElementById('lockErr').textContent='That passcode is not right.';return null}return r.json()}).then(function(i){if(i)start(i)}).catch(function(){document.getElementById('lockErr').textContent='Could not reach Frame Studio. Is the sharing computer on?'})}
document.getElementById('unlock').onclick=function(){key=document.getElementById('code').value;load()};
document.getElementById('code').onkeydown=function(e){if(e.key==='Enter')document.getElementById('unlock').click()};
v.addEventListener('timeupdate',function(){document.getElementById('at').textContent=fmt(v.currentTime)});
try{document.getElementById('name').value=localStorage.getItem('ff-name')||''}catch(e){}
document.getElementById('f').onsubmit=function(e){e.preventDefault();var name=document.getElementById('name').value,text=document.getElementById('text').value,err=document.getElementById('err');err.textContent='';
 try{localStorage.setItem('ff-name',name)}catch(e){}
 fetch(base+'/comments'+q(),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name,text:text,t:v.currentTime})})
 .then(function(r){return r.json().then(function(d){if(!r.ok)throw new Error(d.error||'Could not post');return d})}).then(function(cs){last=cs;render(cs);document.getElementById('text').value=''}).catch(function(x){err.textContent=x.message})};
load();
})();
</script></main></body></html>`;
}

module.exports = {
  createShare, stopShare, listShares, removeComment, ensureServer, stopServer, resumeSharing, status, lanAddress, sharePage, readShares,
};
