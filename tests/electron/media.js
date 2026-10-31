// FFmpeg helpers for generating fixture recordings and inspecting outputs.
const { spawn } = require('child_process');

const { ffmpegPath } = require('../../electron/services/media-service');

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), ['-hide_banner', ...args], { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stderr }));
  });
}

// A MediaRecorder-like WebM: VP8 video + Opus audio, `seconds` long. The
// audio is a 440 Hz tone, so audio duration is measurable after export.
async function makeWebm(outPath, { seconds = 4, size = '640x360', rate = 30, audio = true } = {}) {
  const args = ['-y', '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=${rate}`];
  if (audio) args.push('-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000');
  args.push('-t', String(seconds), '-c:v', 'libvpx', '-b:v', '400k', '-deadline', 'realtime');
  if (audio) args.push('-c:a', 'libopus');
  args.push(outPath);
  const { code, stderr } = await ffmpeg(args);
  if (code !== 0) throw new Error(`fixture generation failed\n${stderr.slice(-1500)}`);
  return outPath;
}

// Decode a stream fully and return its last timestamp (seconds). `which` is
// 'v' or 'a'. Decoding (not header reading) is what a player actually sees.
async function decodedDuration(file, which) {
  const { stderr } = await ffmpeg(['-i', file, '-map', `0:${which}:0`, '-f', 'null', '-']);
  const m = [...stderr.matchAll(/time=(\d+):(\d+):(\d+\.?\d*)/g)].pop();
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

async function probe(file) {
  const { stderr } = await ffmpeg(['-i', file]);
  const video = /Stream #\S+.*Video: (\w+).*?, (\d{2,5})x(\d{2,5})/.exec(stderr);
  const fps = /, (\d+(?:\.\d+)?) fps/.exec(stderr);
  const audio = /Stream #\S+.*Audio: (\w+)/.exec(stderr);
  const dur = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(stderr);
  return {
    videoCodec: video ? video[1] : null,
    width: video ? Number(video[2]) : null,
    height: video ? Number(video[3]) : null,
    fps: fps ? Number(fps[1]) : null,
    audioCodec: audio ? audio[1] : null,
    duration: dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : null,
    raw: stderr,
  };
}

module.exports = { ffmpeg, makeWebm, decodedDuration, probe };
