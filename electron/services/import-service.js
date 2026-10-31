const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const storage = require('./storage');
const mediaService = require('./media-service');

// Turns an existing video file into a project so it can be edited like a
// recording (zooms, captions, masks, export...). The original is never
// modified. H.264/AAC MP4/MOV files are stream-copied (fast, lossless);
// anything else is converted to H.264/AAC MP4, which Chromium plays natively.

const VIDEO_EXTENSIONS = ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi'];
const MAX_IMPORT_BYTES = 20 * 1024 * 1024 * 1024; // 20 GB

function probeStreams(file) {
  return new Promise((resolve) => {
    const child = spawn(mediaService.ffmpegPath(), ['-hide_banner', '-i', file], { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    const done = () => {
      const video = /Stream #\S+.*Video: (\w+).*?, (\d{2,5})x(\d{2,5})/.exec(stderr);
      const audio = /Stream #\S+.*Audio: (\w+)/.exec(stderr);
      resolve({
        videoCodec: video ? video[1] : null,
        width: video ? Number(video[2]) : null,
        height: video ? Number(video[3]) : null,
        audioCodec: audio ? audio[1] : null,
      });
    };
    child.on('close', done);
    child.on('error', done);
  });
}

// Remux when the streams are already browser-friendly, otherwise convert.
function importArgs(src, dest, streams) {
  const copyable =
    streams.videoCodec === 'h264' && (streams.audioCodec === null || streams.audioCodec === 'aac');
  if (copyable) return ['-y', '-i', src, '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', '-movflags', '+faststart', dest];
  return [
    '-y', '-i', src, '-map', '0:v:0', '-map', '0:a:0?',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
    // Even dimensions for yuv420p.
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', dest,
  ];
}

async function importVideo(srcPath, { createProjectDocument }) {
  const ext = path.extname(srcPath).toLowerCase().slice(1);
  if (!VIDEO_EXTENSIONS.includes(ext)) throw new Error('Unsupported video format');
  const stats = fs.statSync(srcPath);
  if (!stats.isFile() || stats.size === 0) throw new Error('Not a video file');
  if (stats.size > MAX_IMPORT_BYTES) throw new Error('Video larger than 20 GB');

  const streams = await probeStreams(srcPath);
  if (!streams.videoCodec) throw new Error('No video stream found in this file');

  const projectId = storage.newProjectId();
  const mediaDir = storage.mediaDir(projectId);
  fs.mkdirSync(mediaDir, { recursive: true });
  fs.mkdirSync(storage.exportsDir(projectId), { recursive: true });
  const dest = path.join(mediaDir, 'screen.mp4');
  try {
    await mediaService.run(importArgs(srcPath, dest, streams));
    const duration = (await mediaService.probeDurationSeconds(dest)) || 1;
    storage.writeJsonAtomic(path.join(mediaDir, 'cursor.json'), { samples: [], clicks: [] });
    const project = createProjectDocument({
      projectId,
      duration,
      sourceName: path.basename(srcPath, path.extname(srcPath)).slice(0, 120) || 'Imported video',
      micLabel: null,
      systemAudio: false,
      mimeType: 'video/mp4',
      hasWebcam: false,
      cursorHidden: false,
      screenPath: 'media/screen.mp4',
    });
    project.imported = { from: path.basename(srcPath).slice(0, 200), at: new Date().toISOString() };
    storage.writeJsonAtomic(storage.projectFile(projectId), project);
    return project;
  } catch (err) {
    // Never leave a half-made project in the library.
    fs.rmSync(storage.projectDir(projectId), { recursive: true, force: true });
    throw err;
  }
}

// Copies (or converts) a video into an existing project so it can be placed
// on the timeline as another clip. Returns the new asset.
async function importClipVideo(projectId, srcPath) {
  const ext = path.extname(srcPath).toLowerCase().slice(1);
  if (!VIDEO_EXTENSIONS.includes(ext)) throw new Error('Unsupported video format');
  const stats = fs.statSync(srcPath);
  if (!stats.isFile() || stats.size === 0) throw new Error('Not a video file');
  if (stats.size > MAX_IMPORT_BYTES) throw new Error('Video larger than 20 GB');

  const streams = await probeStreams(srcPath);
  if (!streams.videoCodec) throw new Error('No video stream found in this file');

  const id = `added-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const dir = path.join(storage.mediaDir(projectId), 'added');
  fs.mkdirSync(dir, { recursive: true });
  const dest = storage.assertInsideBase(path.join(dir, `${id}.mp4`));
  try {
    await mediaService.run(importArgs(srcPath, dest, streams));
    const duration = (await mediaService.probeDurationSeconds(dest)) || 1;
    return {
      id,
      type: 'video',
      path: `media/added/${id}.mp4`,
      duration,
      width: streams.width,
      height: streams.height,
      name: path.basename(srcPath, path.extname(srcPath)).slice(0, 120) || 'Clip',
    };
  } catch (err) {
    fs.rmSync(dest, { force: true });
    throw err;
  }
}

module.exports = { importVideo, importClipVideo, probeStreams, importArgs, VIDEO_EXTENSIONS };
