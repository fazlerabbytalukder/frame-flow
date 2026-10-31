// Studio features end to end: local transcription (real Whisper on real
// speech), transcript data through save/load, podcast voice through the real
// export, local-network share links, and the Windows
// recording utilities (window resize, desktop icons).
const assert = require('assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { execFileSync } = require('child_process');
const { BrowserWindow, screen } = require('electron');

const storage = require('../../electron/services/storage');
const transcribeService = require('../../electron/services/transcribe-service');
const shareServer = require('../../electron/services/share-server');
const windowTools = require('../../electron/services/window-tools');
const { suite, invoke, rejects } = require('./harness');
const { makeProject } = require('./fixtures');
const { ffmpeg, decodedDuration } = require('./media');

const SENTENCE =
  'Hello everyone. Um, today I will show you how to record your screen. Uh, first open the settings page. Then click the record button.';

// Real speech from Windows' built-in voice, so recognition is tested on audio
// that sounds like a person, not on synthetic tones.
function speechWav(ctx) {
  const out = path.join(ctx.fixturesDir, 'speech.wav');
  if (!fs.existsSync(out)) {
    const ps = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Rate = 0; $s.SetOutputToWaveFile('${out.replace(/'/g, "''")}'); $s.Speak('${SENTENCE}'); $s.Dispose()`;
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true });
  }
  return out;
}

// A project whose recording carries the speech as its audio.
async function speechProject(ctx) {
  const p = await makeProject(ctx, { seconds: 12 });
  const media = storage.screenMediaPath(p.id);
  const tmp = media.replace(/(\.\w+)$/, '-speech$1');
  const { code, stderr } = await ffmpeg(['-y', '-i', media, '-i', speechWav(ctx), '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'libopus', '-shortest', tmp]);
  if (code !== 0) throw new Error(stderr.slice(-800));
  fs.renameSync(tmp, media);
  return p;
}

function get(port, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path: urlPath, headers }, (res) => {
        const chunks = [];
        res.on('data', (d) => chunks.push(d));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      })
      .on('error', reject);
  });
}

function post(port, urlPath, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const req = http.request(
      { host: '127.0.0.1', port, path: urlPath, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      (res) => {
        const chunks = [];
        res.on('data', (d) => chunks.push(d));
        res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString() || 'null') }));
      }
    );
    req.on('error', reject);
    req.end(body);
  });
}

function frame(w, h) {
  const buf = Buffer.alloc(w * h * 4, 128);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
}

module.exports = (ctx) => {
  let speech;
  const getSpeech = async () => (speech ||= await speechProject(ctx));

  suite('Transcription (local Whisper)', (test) => {
    test('the speech model ships with the app and loads offline', () => {
      assert.ok(transcribeService.modelAvailable(), `model folder: ${transcribeService.modelRoot()}`);
    });

    test('real speech becomes words with timings, fillers included', async () => {
      const r = await transcribeService.transcribeFile(speechWav(ctx), { language: 'en' });
      const text = r.words.map((w) => w.text.toLowerCase().replace(/[^a-z]/g, '')).join(' ');
      for (const word of ['hello', 'record', 'screen', 'settings', 'button']) assert.ok(text.includes(word), `"${word}" in: ${text}`);
      assert.ok(r.words.length >= 18, `${r.words.length} words`);
      for (let i = 1; i < r.words.length; i++) assert.ok(r.words[i].start >= r.words[i - 1].start, 'times are in order');
      const last = r.words[r.words.length - 1];
      assert.ok(last.end > 6 && last.end <= r.duration + 0.5, `last word ends at ${last.end} of ${r.duration}`);
    });

    test('IPC job: start, poll progress, result handed over once', async () => {
      const p = await getSpeech();
      await rejects(invoke('transcript:start', '../x', 'en'), /Invalid project id/);
      await rejects(invoke('transcript:start', p.id, 'klingon'), /Unsupported language/);
      assert.deepEqual(await invoke('transcript:status', p.id), { state: 'idle', progress: 0 });
      assert.equal((await invoke('transcript:start', p.id, 'en')).state, 'running');
      let st;
      const until = Date.now() + 90_000;
      do {
        await new Promise((r) => setTimeout(r, 300));
        st = await invoke('transcript:status', p.id);
      } while (st.state === 'running' && Date.now() < until);
      assert.equal(st.state, 'done', st.error);
      assert.ok(st.result.words.some((w) => /settings/i.test(w.text)));
      assert.equal((await invoke('transcript:status', p.id)).state, 'idle', 'result is not handed over twice');
      // Saved into the project, it survives validation and reload.
      const doc = await invoke('projects:load', p.id);
      doc.transcript = { words: st.result.words, language: 'en', model: 'whisper-base', captions: true };
      doc.captions = [{ id: 'c1', time: 0, duration: 1, text: 'Hello everyone.', auto: true, words: [{ text: 'Hello', t: 0, d: 0.3 }, { text: 'everyone.', t: 0.3, d: 0.6 }] }];
      doc.style.captions = { look: 'karaoke-not-a-look', animation: 'karaoke', size: 1.2 };
      doc.style.audio = { ...doc.style.audio, voice: 'podcast' };
      await invoke('projects:save', doc);
      const back = await invoke('projects:load', p.id);
      assert.equal(back.transcript.words.length, st.result.words.length);
      assert.equal(back.captions[0].words.length, 2);
      assert.equal(back.captions[0].auto, true);
      assert.equal(back.style.captions.look, 'pill', 'unknown look falls back');
      assert.equal(back.style.captions.animation, 'karaoke');
      assert.equal(back.style.audio.voice, 'podcast');
    });

    test('bad transcript and face-track data are refused', async () => {
      const p = await makeProject(ctx, { seconds: 2 });
      const doc = await invoke('projects:load', p.id);
      await rejects(invoke('projects:save', { ...doc, transcript: { words: [{ text: 1, start: 0, end: 1 }] } }), /Invalid transcript/);
      await rejects(invoke('projects:save', { ...doc, faceTrack: { step: 0.25, points: [[2, 0, 0]] } }), /Invalid face track/);
      await invoke('projects:save', { ...doc, faceTrack: { step: 0.25, points: [[0.5, 0.4, 0.1]] } });
      assert.deepEqual((await invoke('projects:load', p.id)).faceTrack, { step: 0.25, points: [[0.5, 0.4, 0.1]] });
    });
  });

  suite('Podcast voice (export)', (test) => {
    test('the podcast chain runs in the bundled FFmpeg and keeps speech audible and in sync', async () => {
      const p = await getSpeech();
      const clips = [{ start: 0, duration: 8, speed: 1 }];
      const { outputPath } = await invoke('export:start', {
        projectId: p.id, width: 320, height: 180, fps: 15, format: 'mp4', clips, audio: { voice: 'podcast', normalize: true },
      });
      try {
        for (let i = 0; i < 8 * 15; i++) await invoke('export:frame', frame(320, 180));
        await invoke('export:finish');
      } catch (err) {
        await invoke('export:cancel').catch(() => {});
        throw err;
      }
      const v = await decodedDuration(outputPath, 'v');
      const a = await decodedDuration(outputPath, 'a');
      assert.ok(Math.abs(a - v) < 0.15, `audio ${a} vs video ${v}`);
      const vol = await ffmpeg(['-i', outputPath, '-af', 'volumedetect', '-f', 'null', '-']);
      const mean = Number((/mean_volume: (-?[\d.]+) dB/.exec(vol.stderr) || [])[1]);
      assert.ok(mean > -35, `speech audible after the voice chain, mean ${mean} dB`);
    });
  });

  suite('Library thumbnails', (test) => {
    test('a poster frame is made once, cached, and refreshed when the recording changes', async () => {
      await rejects(invoke('projects:thumbnail', '../x'), /Invalid project id/);
      const p = await makeProject(ctx, { seconds: 2 });
      const url = await invoke('projects:thumbnail', p.id);
      assert.match(url, new RegExp(`^frameflow-media://${p.id}/media/thumb\\.jpg\\?v=\\d+$`));
      const thumb = path.join(storage.mediaDir(p.id), 'thumb.jpg');
      const jpg = fs.readFileSync(thumb);
      assert.ok(jpg.length > 1000 && jpg[0] === 0xff && jpg[1] === 0xd8, 'a real JPEG');
      assert.equal(await invoke('projects:thumbnail', p.id), url, 'cached: same version');
      // A newer recording makes the thumbnail stale.
      const later = new Date(Date.now() + 5000);
      fs.utimesSync(storage.screenMediaPath(p.id), later, later);
      assert.notEqual(await invoke('projects:thumbnail', p.id), url);
      const list = await invoke('projects:list');
      const row = list.find((x) => x.id === p.id);
      assert.equal(row.width, 1920);
      assert.equal(row.hasWebcam, false);
      assert.equal(row.captionCount, 0);
    });
  });

  suite('Share links (local network)', (test) => {
    let p;
    let exportFile;
    let port;
    const setup = async () => {
      if (p) return;
      p = await makeProject(ctx, { seconds: 2 });
      fs.mkdirSync(storage.exportsDir(p.id), { recursive: true });
      exportFile = path.join(storage.exportsDir(p.id), 'export-share.mp4');
      fs.copyFileSync(storage.screenMediaPath(p.id), exportFile);
      // Tests listen on loopback only (no firewall prompt); the app uses the LAN.
      port = await shareServer.ensureServer('127.0.0.1');
    };

    test('only Frame Studio exports of that project can be shared', async () => {
      await setup();
      await rejects(invoke('share:create', p.id, storage.screenMediaPath(p.id), {}), /Invalid export path/);
      await rejects(invoke('share:create', p.id, 'C:\\Windows\\win.ini', {}), /Invalid export path|escapes Frame Studio storage/);
      await rejects(invoke('share:create', '../x', exportFile, {}), /Invalid project id/);
    });

    test('viewer page, video with seeking, views and comments', async () => {
      await setup();
      const share = await invoke('share:create', p.id, exportFile, { title: 'Demo <script>alert(1)</script>', showViews: true });
      assert.match(share.url, new RegExp(`:${port}/v/[A-Za-z0-9_-]{24}$`));
      const base = new URL(share.url).pathname;

      const page = await get(port, base);
      assert.equal(page.status, 200);
      assert.match(page.headers['content-security-policy'], /default-src 'none'/);
      assert.equal(page.headers['x-content-type-options'], 'nosniff');
      assert.ok(!page.body.toString().includes('<script>alert(1)'), 'title is escaped');
      assert.ok(page.body.toString().includes('Demo &lt;script&gt;'));

      const info1 = JSON.parse((await get(port, `${base}/info`)).body);
      const info2 = JSON.parse((await get(port, `${base}/info`)).body);
      assert.equal(info1.views, 1);
      assert.equal(info2.views, 1, 'the same viewer counts once per half hour');

      const size = fs.statSync(exportFile).size;
      const range = await get(port, `${base}/video`, { Range: 'bytes=10-109' });
      assert.equal(range.status, 206);
      assert.equal(range.headers['content-range'], `bytes 10-109/${size}`);
      assert.deepEqual(range.body, fs.readFileSync(exportFile).subarray(10, 110));

      const posted = await post(port, `${base}/comments`, { name: 'Sam', text: 'Zoom in here <b>please</b>', t: 1.234 });
      assert.equal(posted.status, 201);
      assert.equal(posted.json[0].t, 1.2);
      assert.equal(posted.json[0].text, 'Zoom in here <b>please</b>', 'stored as text; the page renders it with textContent');
      assert.equal((await post(port, `${base}/comments`, { text: '', t: 1 })).status, 400);
      assert.equal((await post(port, `${base}/comments`, { text: 'x', t: -1 })).status, 400);

      const listed = (await invoke('share:list')).shares.find((s) => s.id === share.id);
      assert.equal(listed.views, 1);
      assert.equal(listed.comments.length, 1);
      assert.ok(!('token' in listed) && !('file' in listed), 'internal fields stay in the main process');
      const after = await invoke('share:remove-comment', share.id, listed.comments[0].id);
      assert.equal(after.comments.length, 0);

      assert.equal((await get(port, '/v/AAAAAAAAAAAAAAAAAAAAAAAA')).status, 404);
      assert.equal((await get(port, '/v/../../etc/passwd')).status, 404);
      assert.equal((await get(port, '/')).status, 404);
      await invoke('share:stop', share.id);
      assert.equal((await get(port, base).catch(() => ({ status: 'closed' }))).status !== 200, true, 'stopped link is gone');
    });

    test('a passcode protects the video and comments, not just the page', async () => {
      await setup();
      port = await shareServer.ensureServer('127.0.0.1');
      const share = await invoke('share:create', p.id, exportFile, { title: 'Private', passcode: 'open sesame', showViews: false });
      const base = new URL(share.url).pathname;
      assert.equal((await get(port, `${base}/info`)).status, 403);
      assert.equal((await get(port, `${base}/video`)).status, 403);
      assert.equal((await get(port, `${base}/info?k=wrong`)).status, 403);
      const ok = await get(port, `${base}/info?k=${encodeURIComponent('open sesame')}`);
      assert.equal(ok.status, 200);
      assert.equal(JSON.parse(ok.body).views, null, 'view count hidden from viewers when the owner chose so');
      await invoke('share:stop', share.id);
      assert.equal(shareServer.status().running, false, 'server stops with the last link');
    });
  });

  suite('Recording utilities (Windows)', (test) => {
    test('window ids parse strictly', () => {
      assert.equal(windowTools.hwndFromSourceId('window:132456:0'), 132456);
      for (const bad of ['screen:1:0', 'window:abc:0', 'window:-1:0', 'window:1', 'window:1:0;calc', null]) {
        assert.throws(() => windowTools.hwndFromSourceId(bad), /Pick a window/);
      }
    });

    test('a real window is resized to an exact pixel size (hidden test window)', async () => {
      await rejects(invoke('tools:resize-window', 1280, 720), /Pick a window to resize/);
      await rejects(windowTools.resizeWindow(1, 100, 100), /Invalid window size/);
      const win = new BrowserWindow({ show: false, frame: false, width: 300, height: 200, x: 40, y: 40, focusable: false });
      try {
        const hwnd = win.getNativeWindowHandle().readBigUInt64LE(0);
        const r = await windowTools.resizeWindow(Number(hwnd), 640, 400);
        assert.equal(r.width, 640);
        assert.equal(r.height, 400);
        const scale = screen.getDisplayMatching(win.getBounds()).scaleFactor;
        const [w, h] = win.getSize();
        assert.ok(Math.abs(w * scale - 640) <= 2 && Math.abs(h * scale - 400) <= 2, `Electron sees ${w}x${h} at ${scale}x`);
      } finally {
        win.destroy();
      }
    });

    test('desktop icons: state is read, and only icons we hid are restored', async () => {
      const state = await windowTools.desktopIconsState();
      assert.equal(typeof state.found, 'boolean');
      // Setting the current state is a no-op on screen but runs the real path.
      if (state.found) assert.equal((await windowTools.setDesktopIconsForTest(state.hidden)).hidden, state.hidden);
      assert.deepEqual(await windowTools.restoreDesktopIcons(), { restored: false });
      await rejects(invoke('tools:desktop-icons', 'yes'), /Invalid flag/);
    });
  });
};
