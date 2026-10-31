// Deterministic export: walk the timeline frame by frame, map each frame to
// its source-video time through the clip sequence (speed-aware), seek,
// composite with the exact same engine the preview uses — including cursor
// overlay, click ripples, annotations, captions, webcam and fade transitions —
// and stream raw RGBA buffers to the FFmpeg encoder in the main process.

import { composeFrame } from './frame-state.js';
import { usesCutout } from './camera-layout.js';
import { loadPersonSegmenter } from './person-mask.js';
import { totalDuration, resolve, sourceToTimelineTimes } from './timeline-engine.js';

// Motion-blur sub-frames per exported frame (the preview uses fewer).
const EXPORT_BLUR_SAMPLES = 8;

// Resolution presets scale the project's short side to the standard heights,
// so 16:9, 1:1 and 9:16 all export correctly (dimensions rounded to even
// numbers for the H.264 encoder). GIF stops at 1080p.
export function resolutionOptions(projectW, projectH, format = 'mp4') {
  const even = (v) => Math.max(16, Math.round(v / 2) * 2);
  const short = Math.min(projectW, projectH);
  const presets = [
    { id: '720p', label: '720p', short: 720 },
    { id: '1080p', label: '1080p', short: 1080 },
    { id: '4k', label: '4K', short: 2160 },
  ].filter((p) => format !== 'gif' || p.short <= 1080);
  return presets.map((p) => {
    const f = p.short / short;
    const width = even(projectW * f);
    const height = even(projectH * f);
    return { id: p.id, label: `${p.label} (${width}×${height})`, width, height };
  });
}

function seekTo(video, t) {
  return new Promise((resolve, reject) => {
    // Seeking to the already-current time fires no 'seeked' event.
    if (Math.abs(video.currentTime - t) < 0.0005) return resolve();
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('Video seek failed'));
    };
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    video.currentTime = t;
  });
}

function loadVideo(url) {
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.src = url;
  return new Promise((resolve, reject) => {
    video.addEventListener('loadedmetadata', () => resolve(video), { once: true });
    video.addEventListener('error', () => reject(new Error('Could not load video')), { once: true });
  });
}

async function loadBackgroundImage(project) {
  if (project.style.background !== 'image' || !project.style.backgroundImage) return null;
  try {
    const url = await window.frameflow.projects.mediaUrl(project.id, project.style.backgroundImage);
    return await new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = url;
    });
  } catch {
    return null;
  }
}

// A looping background video (style.background === 'video'). A broken file
// degrades to the fallback background, never a failed export.
async function loadBackgroundVideo(project) {
  if (project.style.background !== 'video' || !project.style.backgroundVideo) return null;
  try {
    const url = await window.frameflow.projects.mediaUrl(project.id, project.style.backgroundVideo);
    const video = await loadVideo(url);
    return video.duration > 0 ? video : null;
  } catch {
    return null;
  }
}

// The webcam recording's own time for a source (screen) time. Native screen
// capture starts the webcam a moment after the video (recording.webcamOffset).
export function webcamTimeFor(project, sourceTime) {
  const off = Number(project.recording?.webcamOffset) || 0;
  return Math.max(0, sourceTime - off);
}

// Background videos loop on the timeline clock.
export function backgroundVideoTime(timelineTime, videoDuration) {
  if (!(videoDuration > 0)) return 0;
  return Math.min(timelineTime % videoDuration, Math.max(0, videoDuration - 0.001));
}

// Audio post-processing options for the encoder: click sounds are placed on
// the edited timeline here, where the clip mapping lives.
export function audioOptionsFor(project, cursorTrack) {
  const a = project.style.audio || {};
  const clicks = a.clickSounds && cursorTrack?.clicks ? cursorTrack.clicks.map((c) => c.t) : [];
  return {
    denoise: Boolean(a.denoise),
    normalize: Boolean(a.normalize),
    voice: a.voice || (a.denoise ? 'noise' : 'standard'),
    clickSounds: Boolean(a.clickSounds),
    clickVolume: a.clickVolume ?? 0.6,
    clickTimes: sourceToTimelineTimes(project.clips, clicks),
    music: Boolean(a.music?.path),
    musicVolume: a.music?.volume ?? 0.25,
  };
}

export async function runExport({
  project, videoUrl, webcamUrl, cursorTrack,
  width, height, fps, format = 'mp4', quality = 'high', hardware = true,
  onProgress, shouldCancel,
}) {
  const video = await loadVideo(videoUrl).catch(() => {
    throw new Error('Could not load source video');
  });

  // Optional webcam track; a broken file degrades to no overlay, never a
  // failed export.
  let webcam = null;
  if (webcamUrl && project.style.webcam?.enabled !== false) {
    webcam = await loadVideo(webcamUrl).catch(() => null);
  }

  // Camera cutout needs the person segmenter; if it can't load, cutout
  // blocks show the framed camera instead (same as the preview).
  const masker =
    webcam && (project.layouts || []).some((l) => l.layout === 'cutout')
      ? await loadPersonSegmenter().catch(() => null)
      : null;

  // Videos added to the timeline, by asset id.
  const addedVideos = new Map();
  for (const asset of project.assets || []) {
    if (asset.type !== 'video' || !project.clips.some((c) => c.assetId === asset.id)) continue;
    const url = await window.frameflow.projects.mediaUrl(project.id, asset.path);
    addedVideos.set(asset.id, await loadVideo(url).catch(() => {
      throw new Error(`Could not load the clip "${asset.name || asset.id}"`);
    }));
  }

  const backgroundImage = await loadBackgroundImage(project);
  const backgroundVideo = await loadBackgroundVideo(project);

  const duration = totalDuration(project.clips);
  const totalFrames = Math.max(1, Math.round(duration * fps));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  // The main process reads the saved document (e.g. the music file), so make
  // sure disk matches what is being exported.
  await window.frameflow.projects.save(project);

  const started = await window.frameflow.export.start({
    projectId: project.id,
    width,
    height,
    fps,
    format,
    clips: project.clips.map((c) => ({ start: c.start, duration: c.duration, speed: c.speed || 1, assetId: c.assetId })),
    volume: project.style.volume ?? 1,
    quality,
    hardware,
    audio: audioOptionsFor(project, cursorTrack),
  });

  try {
    for (let i = 0; i < totalFrames; i++) {
      if (shouldCancel && shouldCancel()) {
        await window.frameflow.export.cancel();
        return { cancelled: true };
      }

      const timelineTime = i / fps;
      const hit = resolve(project.clips, timelineTime);
      const source = (hit && addedVideos.get(hit.clip.assetId)) || video;
      const onRecording = source === video;
      const t = Math.min(hit ? hit.sourceTime : 0, Math.max(0, source.duration - 0.001));
      await seekTo(source, t);
      if (webcam && onRecording) {
        await seekTo(webcam, Math.min(webcamTimeFor(project, t), Math.max(0, webcam.duration - 0.001))).catch(() => {});
      }
      if (backgroundVideo) {
        await seekTo(backgroundVideo, backgroundVideoTime(timelineTime, backgroundVideo.duration)).catch(() => {});
      }

      composeFrame(
        ctx,
        project,
        cursorTrack,
        timelineTime,
        {
          video: source,
          videoW: source.videoWidth,
          videoH: source.videoHeight,
          canvasW: width,
          canvasH: height,
          webcamVideo: onRecording ? webcam : null,
          webcamMask: onRecording && masker && usesCutout(project.layouts, timelineTime) ? masker.maskFor(webcam) : null,
          backgroundImage,
          backgroundVideo,
        },
        { sourceTime: t, blurSamples: EXPORT_BLUR_SAMPLES }
      );

      const pixels = ctx.getImageData(0, 0, width, height);
      // Pass a standalone ArrayBuffer (the ImageData buffer is reused by the canvas).
      await window.frameflow.export.frame(pixels.data.buffer.slice(0));

      if (onProgress) onProgress((i + 1) / totalFrames);
    }

    const result = await window.frameflow.export.finish();
    return { cancelled: false, encoder: started.encoder, ...result };
  } catch (err) {
    try {
      await window.frameflow.export.cancel();
    } catch {
      // already closed
    }
    throw err;
  } finally {
    video.removeAttribute('src');
    video.load();
    for (const extra of [webcam, backgroundVideo, ...addedVideos.values()]) {
      if (!extra) continue;
      extra.removeAttribute('src');
      extra.load();
    }
  }
}
