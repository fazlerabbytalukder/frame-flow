const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

// Serves a local media file as a Response with HTTP Range support.
// <video> seeks by asking for byte ranges; Electron's net module ignores the
// Range header for file:// URLs, which made seeks re-read the file from
// byte 0 and playback stall at random after scrubbing.

const CONTENT_TYPES = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.json': 'application/json',
};

function contentTypeOf(absPath) {
  return CONTENT_TYPES[path.extname(absPath).toLowerCase()] || 'application/octet-stream';
}

// Returns {start, end} (inclusive), null for "send the whole file", or
// 'unsatisfiable'. Multi-range requests get the whole file.
function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m) return null;
  const [, a, b] = m;
  if (a === '' && b === '') return null;
  let start;
  let end;
  if (a === '') {
    // Suffix range: the last N bytes.
    const n = Number(b);
    if (n === 0) return 'unsatisfiable';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(a);
    end = b === '' ? size - 1 : Math.min(Number(b), size - 1);
  }
  if (start >= size || start > end) return 'unsatisfiable';
  return { start, end };
}

function fileResponse(absPath, rangeHeader) {
  const size = fs.statSync(absPath).size;
  const headers = {
    'Content-Type': contentTypeOf(absPath),
    'Accept-Ranges': 'bytes',
  };
  const range = parseRange(rangeHeader, size);
  if (range === 'unsatisfiable') {
    return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
  }
  const { start, end } = range || { start: 0, end: size - 1 };
  const length = size === 0 ? 0 : end - start + 1;
  const body = length === 0 ? null : Readable.toWeb(fs.createReadStream(absPath, { start, end }));
  headers['Content-Length'] = String(length);
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  return new Response(body, { status: range ? 206 : 200, headers });
}

module.exports = { fileResponse, parseRange, contentTypeOf };
