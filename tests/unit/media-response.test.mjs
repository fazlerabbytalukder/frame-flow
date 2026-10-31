import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { fileResponse, parseRange, contentTypeOf } = require('../../electron/services/media-response.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-media-'));
const file = path.join(dir, 'clip.mp4');
const bytes = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256));
fs.writeFileSync(file, bytes);

test('parseRange handles open, closed, suffix and bad ranges', () => {
  assert.equal(parseRange(null, 1000), null);
  assert.deepEqual(parseRange('bytes=0-', 1000), { start: 0, end: 999 });
  assert.deepEqual(parseRange('bytes=100-199', 1000), { start: 100, end: 199 });
  assert.deepEqual(parseRange('bytes=900-5000', 1000), { start: 900, end: 999 });
  assert.deepEqual(parseRange('bytes=-100', 1000), { start: 900, end: 999 });
  assert.equal(parseRange('bytes=1000-', 1000), 'unsatisfiable');
  assert.equal(parseRange('bytes=300-200', 1000), 'unsatisfiable');
  assert.equal(parseRange('bytes=0-1,5-9', 1000), null);
});

test('no Range header serves the whole file with Accept-Ranges', async () => {
  const res = fileResponse(file, null);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('accept-ranges'), 'bytes');
  assert.equal(res.headers.get('content-length'), '1000');
  assert.equal(res.headers.get('content-type'), 'video/mp4');
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), bytes);
});

test('a Range request returns 206 with exactly those bytes', async () => {
  const res = fileResponse(file, 'bytes=500-509');
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), 'bytes 500-509/1000');
  assert.equal(res.headers.get('content-length'), '10');
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), bytes.subarray(500, 510));
});

test('an unsatisfiable range returns 416', () => {
  const res = fileResponse(file, 'bytes=2000-');
  assert.equal(res.status, 416);
  assert.equal(res.headers.get('content-range'), 'bytes */1000');
});

test('content types cover recorded media', () => {
  assert.equal(contentTypeOf('a/screen.webm'), 'video/webm');
  assert.equal(contentTypeOf('a/B.PNG'), 'image/png');
  assert.equal(contentTypeOf('a/x.bin'), 'application/octet-stream');
});
