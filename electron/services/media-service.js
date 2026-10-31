const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Thin wrapper around the bundled FFmpeg binary. All callers pass validated,
// storage-rooted paths; this module never builds paths from renderer input.

function ffmpegPath() {
  // ffmpeg-static resolves to the platform binary at install time. In a
  // packaged app the module lives inside app.asar but binaries can only run
  // from the unpacked copy (see asarUnpack in package.json).
  let p = require('ffmpeg-static');
  if (p && p.includes('app.asar')) p = p.replace('app.asar', 'app.asar.unpacked');
  if (!p || !fs.existsSync(p)) throw new Error('Bundled FFmpeg binary not found');
  return p;
}

function run(args, { onStderr } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > 65536) stderr = stderr.slice(-32768);
      if (onStderr) onStderr(d.toString());
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exited with code ${code}\n${stderr.slice(-2000)}`));
    });
  });
}

// MediaRecorder WebM files have no duration/seek index, which breaks frame
// seeking in the editor. Remux (stream copy, fast) into a well-formed file.
async function remuxWebm(inputPath, outputPath) {
  await run(['-y', '-i', inputPath, '-c', 'copy', outputPath]);
}

// Native capture: Matroska video (no audio) + the renderer's audio track,
// which started `audioOffset` seconds after the video (negative: before).
// The video is stream-copied; audio becomes AAC in a fast-start MP4.
function nativeMuxArgs({ videoPath, audioPath, audioOffset = 0, outputPath }) {
  const args = ['-y', '-i', videoPath];
  if (audioPath) {
    const off = Math.abs(audioOffset).toFixed(3);
    if (audioOffset >= 0) args.push('-itsoffset', off, '-i', audioPath);
    else args.push('-ss', off, '-i', audioPath);
    args.push('-map', '0:v:0', '-map', '1:a:0?', '-c:a', 'aac', '-b:a', '192k');
  } else {
    args.push('-map', '0:v:0');
  }
  args.push('-c:v', 'copy', '-movflags', '+faststart', outputPath);
  return args;
}

async function muxNativeRecording(opts) {
  await run(nativeMuxArgs(opts));
}

// Probe duration by decoding timestamps (works even for unindexed files).
function probeDurationSeconds(inputPath) {
  return new Promise((resolve) => {
    const child = spawn(ffmpegPath(), ['-i', inputPath, '-f', 'null', '-'], { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > 131072) stderr = stderr.slice(-65536);
    });
    child.on('close', () => {
      const matches = [...stderr.matchAll(/time=(\d+):(\d+):(\d+\.?\d*)/g)];
      if (matches.length === 0) return resolve(null);
      const m = matches[matches.length - 1];
      resolve(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
    });
    child.on('error', () => resolve(null));
  });
}

// atempo is only artefact-free within 0.5..2, so larger changes chain filters
// (e.g. 4x -> atempo=2,atempo=2). Returns '' for normal speed.
function atempoChain(speed) {
  if (speed === 1) return '';
  const parts = [];
  let s = speed;
  while (s > 2 + 1e-9) {
    parts.push(2);
    s /= 2;
  }
  while (s < 0.5 - 1e-9) {
    parts.push(0.5);
    s /= 0.5;
  }
  parts.push(s);
  return parts.map((p) => `,atempo=${p.toFixed(4)}`).join('');
}

// --- video encoders -----------------------------------------------------------

// Constant-quality level per preset: lower = better. x264 CRF and the GPU
// encoders' CQ/QP scales line up closely enough at these values.
const QUALITY_LEVELS = { high: 18, balanced: 23, small: 28 };

// GPU encoders in preference order. All are compiled into the bundled FFmpeg;
// which one works depends on the user's graphics hardware and drivers.
const HARDWARE_ENCODERS = ['h264_nvenc', 'h264_qsv', 'h264_amf'];

function videoCodecArgs(encoder, quality) {
  const q = String(QUALITY_LEVELS[quality] ?? QUALITY_LEVELS.high);
  switch (encoder) {
    case 'h264_nvenc':
      return ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', q, '-b:v', '0', '-pix_fmt', 'yuv420p'];
    case 'h264_qsv':
      return ['-c:v', 'h264_qsv', '-preset', 'medium', '-global_quality', q, '-pix_fmt', 'nv12'];
    case 'h264_amf':
      return ['-c:v', 'h264_amf', '-rc', 'cqp', '-qp_i', q, '-qp_p', q, '-pix_fmt', 'yuv420p'];
    default:
      return ['-c:v', 'libx264', '-preset', 'medium', '-crf', q, '-pix_fmt', 'yuv420p'];
  }
}

// Try each GPU encoder on a tiny synthetic clip; the first that encodes wins.
// Cached for the process lifetime (drivers don't change mid-session).
let hardwareProbe = null;

function detectHardwareEncoder() {
  if (!hardwareProbe) {
    hardwareProbe = (async () => {
      for (const enc of HARDWARE_ENCODERS) {
        try {
          await run([
            '-hide_banner', '-loglevel', 'error',
            '-f', 'lavfi', '-i', 'testsrc2=size=256x144:rate=30', '-frames:v', '5',
            ...videoCodecArgs(enc, 'balanced'),
            '-f', 'null', '-',
          ]);
          return enc;
        } catch {
          // Not available on this machine.
        }
      }
      return null;
    })();
  }
  return hardwareProbe;
}

// Whether a media file contains an audio stream. A recording made with no mic
// and no system audio has none, and the export graph must not reference it.
const audioStreamCache = new Map();

async function hasAudioStream(file) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return false;
  }
  const key = `${file}|${stat.size}|${stat.mtimeMs}`;
  if (!audioStreamCache.has(key)) {
    audioStreamCache.set(
      key,
      new Promise((resolve) => {
        const child = spawn(ffmpegPath(), ['-hide_banner', '-i', file], { windowsHide: true });
        let stderr = '';
        child.stderr.on('data', (d) => {
          stderr += d.toString();
        });
        child.on('close', () => resolve(/Stream #\S+.*Audio:/.test(stderr)));
        child.on('error', () => resolve(false));
      })
    );
  }
  return audioStreamCache.get(key);
}

// A short, synthesized "tick" for click sounds: two decaying sines. Generated
// by FFmpeg, so no third-party audio asset (or licence) is involved.
const CLICK_SOUND =
  "aevalsrc='0.55*sin(2*PI*1900*t)*exp(-t*140)+0.25*sin(2*PI*3700*t)*exp(-t*220)':s=48000:d=0.06";

// Builds the export audio filter graph. Pure (strings in, string out) so it
// can be unit-tested. Inputs are referenced by index:
//   voice  — the recording's audio, cut and retimed per clip, then volume,
//            optional noise reduction and loudness normalization
//   clicks — one synthesized tick, delayed to every click's timeline time
//   music  — looped background track, trimmed to the video, faded out
// Returns { graph, label } or null when there is no audio at all.
// Voice clean-up per mode (style.audio.voice):
//   standard  the microphone as recorded
//   noise     broadband noise reduction (fans, hum, room)
//   podcast   noise reduction plus a voice chain: rumble cut, de-ess, gentle
//             compression, a touch of presence, and a limiter
const VOICE_MODES = ['standard', 'noise', 'podcast'];

function voiceFilters(mode) {
  if (mode === 'noise') return ['afftdn=nf=-25'];
  if (mode === 'podcast') {
    return [
      'highpass=f=80',
      'afftdn=nf=-28',
      'deesser=i=0.4',
      'acompressor=threshold=0.089:ratio=3:attack=8:release=160:makeup=2',
      'equalizer=f=180:t=q:w=1:g=1.5',
      'equalizer=f=3200:t=q:w=1.2:g=2.5',
      'alimiter=limit=0.89',
    ];
  }
  return [];
}

function buildAudioGraph({
  voiceInput = null, clips = [], volume = 1, denoise = false, normalize = false, voice = null,
  clickInput = null, clickTimes = [], clickVolume = 0.6,
  musicInput = null, musicVolume = 0.25, total = 0,
}) {
  const chains = [];
  const mixInputs = [];

  // Per-clip sources: clips carry `input` (an FFmpeg input index, or null
  // for a file without audio, which becomes silence of the clip's length).
  const perClip = clips.some((c) => c && 'input' in c);
  if (perClip && clips.length > 0) {
    const fmt = 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo';
    const byInput = new Map();
    clips.forEach((c, i) => {
      if (c.input == null) return;
      if (!byInput.has(c.input)) byInput.set(c.input, []);
      byInput.get(c.input).push(i);
    });
    for (const [input, idx] of byInput) chains.push(`[${input}:a]asplit=${idx.length}${idx.map((i) => `[s${i}]`).join('')}`);
    clips.forEach((c, i) => {
      const speed = Number.isFinite(c.speed) && c.speed >= 0.25 && c.speed <= 4 ? c.speed : 1;
      const len = (c.duration / speed).toFixed(3);
      if (c.input == null) {
        chains.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${len},asetpts=PTS-STARTPTS,${fmt}[a${i}]`);
      } else {
        // Padded and trimmed to the clip's exact length so the cuts stay in sync.
        chains.push(
          `[s${i}]atrim=start=${c.start.toFixed(3)}:end=${(c.start + c.duration).toFixed(3)},` +
            `asetpts=PTS-STARTPTS${atempoChain(speed)},${fmt},apad=whole_dur=${len},atrim=duration=${len}[a${i}]`
        );
      }
    });
    const post = [];
    if (Number.isFinite(volume) && volume !== 1) post.push(`volume=${Math.min(2, Math.max(0, volume)).toFixed(2)}`);
    post.push(...voiceFilters(VOICE_MODES.includes(voice) ? voice : denoise ? 'noise' : 'standard'));
    if (normalize) post.push('loudnorm=I=-16:TP=-1.5:LRA=11', 'aresample=48000');
    const labels = clips.map((c, i) => `[a${i}]`).join('');
    chains.push(`${labels}concat=n=${clips.length}:v=0:a=1${post.length ? ',' + post.join(',') : ''}[voice]`);
    mixInputs.push('[voice]');
  } else if (voiceInput != null && clips.length > 0) {
    const n = clips.length;
    const splits = clips.map((c, i) => `[s${i}]`).join('');
    const parts = clips
      .map((c, i) => {
        const speed = Number.isFinite(c.speed) && c.speed >= 0.25 && c.speed <= 4 ? c.speed : 1;
        return (
          `[s${i}]atrim=start=${c.start.toFixed(3)}:end=${(c.start + c.duration).toFixed(3)},` +
          `asetpts=PTS-STARTPTS${atempoChain(speed)}[a${i}]`
        );
      })
      .join(';');
    const labels = clips.map((c, i) => `[a${i}]`).join('');
    const post = [];
    if (Number.isFinite(volume) && volume !== 1) post.push(`volume=${Math.min(2, Math.max(0, volume)).toFixed(2)}`);
    post.push(...voiceFilters(VOICE_MODES.includes(voice) ? voice : denoise ? 'noise' : 'standard'));
    // loudnorm resamples internally to 192 kHz; bring it back to 48 kHz.
    if (normalize) post.push('loudnorm=I=-16:TP=-1.5:LRA=11', 'aresample=48000');
    chains.push(`[${voiceInput}:a]asplit=${n}${splits}`, parts);
    chains.push(`${labels}concat=n=${n}:v=0:a=1${post.length ? ',' + post.join(',') : ''}[voice]`);
    mixInputs.push('[voice]');
  }

  if (clickInput != null && clickTimes.length > 0) {
    const n = clickTimes.length;
    const outs = clickTimes.map((_, i) => `[k${i}]`).join('');
    chains.push(`[${clickInput}:a]volume=${Math.min(1, Math.max(0, clickVolume)).toFixed(2)},asplit=${n}${outs}`);
    clickTimes.forEach((t, i) => {
      const ms = Math.max(0, Math.round(t * 1000));
      chains.push(`[k${i}]adelay=${ms}:all=1[d${i}]`);
    });
    const delayed = clickTimes.map((_, i) => `[d${i}]`).join('');
    // Each tick is padded to full length before mixing (see the note below).
    if (n === 1) {
      chains.push(`${delayed}anull[clicks]`);
    } else {
      const T = Math.max(0.01, total).toFixed(3);
      const pads = clickTimes.map((_, i) => {
        chains.push(`[d${i}]apad=whole_dur=${T}[q${i}]`);
        return `[q${i}]`;
      });
      chains.push(`${pads.join('')}amix=inputs=${n}:normalize=0:duration=longest:dropout_transition=0[clicks]`);
    }
    mixInputs.push('[clicks]');
  }

  if (musicInput != null && total > 0) {
    const fade = Math.min(2, total / 4);
    chains.push(
      `[${musicInput}:a]atrim=0:${total.toFixed(3)},asetpts=PTS-STARTPTS,` +
        `volume=${Math.min(1, Math.max(0, musicVolume)).toFixed(2)},` +
        `afade=t=out:st=${(total - fade).toFixed(3)}:d=${fade.toFixed(3)}[music]`
    );
    mixInputs.push('[music]');
  }

  if (mixInputs.length === 0) return null;
  // The encoder runs with -shortest, so the audio must last exactly as long
  // as the video: pad with silence (a click track ends at its last tick) and
  // trim (music loops forever). Padding happens per input, BEFORE amix —
  // apad placed after amix does not extend its output in FFmpeg 6.
  const T = Math.max(0.01, total).toFixed(3);
  const fit = `apad=whole_dur=${T},atrim=0:${T}`;
  if (mixInputs.length === 1) {
    chains.push(`${mixInputs[0]}${fit}[aout]`);
  } else {
    const padded = mixInputs.map((label, i) => {
      chains.push(`${label}${fit}[p${i}]`);
      return `[p${i}]`;
    });
    // normalize=0 keeps each source at its own level instead of dividing by N.
    chains.push(`${padded.join('')}amix=inputs=${padded.length}:normalize=0:duration=longest:dropout_transition=0[aout]`);
  }
  return { graph: chains.join(';'), label: '[aout]' };
}

// Spawn an FFmpeg process that accepts raw RGBA frames on stdin and encodes
// H.264 MP4. The audio track is rebuilt from the project's clip windows
// (trim + concat) so it stays in sync with the edited timeline, then mixed
// with click sounds and background music when enabled.
async function startRawFrameEncoder({
  width, height, fps, audioSourcePath, clips, volume = 1, outputPath, onStderr,
  encoder = 'libx264', quality = 'high', audio = {},
}) {
  const args = ['-y'];

  args.push(
    '-f', 'rawvideo',
    '-pix_fmt', 'rgba',
    '-s', `${width}x${height}`,
    '-r', String(fps),
    '-i', '-',
  );

  const clipList = Array.isArray(clips) ? clips : [];
  const total = clipList.reduce((s, c) => s + c.duration / (c.speed || 1), 0);
  let nextInput = 1;
  let voiceInput = null;
  let voiceClips = clipList;
  if (audioSourcePath && clipList.length > 0) {
    // Each clip's sound comes from its own file: the recording, or a video
    // added to the timeline (clip.path, resolved by the main process).
    const files = [...new Set(clipList.map((c) => c.path || audioSourcePath))];
    const inputOf = new Map();
    for (const f of files) {
      if (await hasAudioStream(f)) {
        args.push('-i', f);
        inputOf.set(f, nextInput++);
      }
    }
    if (inputOf.size > 0) {
      if (files.length === 1) voiceInput = inputOf.get(files[0]);
      else voiceClips = clipList.map((c) => ({ ...c, input: inputOf.get(c.path || audioSourcePath) ?? null }));
    }
  }
  let clickInput = null;
  const clickTimes = Array.isArray(audio.clickTimes) ? audio.clickTimes : [];
  if (audio.clickSounds && clickTimes.length > 0) {
    args.push('-f', 'lavfi', '-i', CLICK_SOUND);
    clickInput = nextInput++;
  }
  let musicInput = null;
  if (audio.musicPath && fs.existsSync(audio.musicPath)) {
    args.push('-stream_loop', '-1', '-i', audio.musicPath);
    musicInput = nextInput++;
  }

  const built = buildAudioGraph({
    voiceInput, clips: voiceClips, volume,
    denoise: Boolean(audio.denoise), normalize: Boolean(audio.normalize), voice: audio.voice,
    clickInput, clickTimes, clickVolume: audio.clickVolume ?? 0.6,
    musicInput, musicVolume: audio.musicVolume ?? 0.25, total,
  });
  if (built) args.push('-filter_complex', built.graph);
  const hasAudio = Boolean(built);

  args.push(
    '-map', '0:v:0',
    ...(hasAudio ? ['-map', built.label, '-c:a', 'aac', '-b:a', '192k'] : []),
    ...videoCodecArgs(encoder, quality),
    '-movflags', '+faststart',
    '-shortest',
    outputPath,
  );

  const child = spawn(ffmpegPath(), args, { windowsHide: true });
  // If FFmpeg exits early, writes to its stdin fail with EPIPE/EOF. Without a
  // listener that error would be an uncaught exception in the main process;
  // the real failure is reported through `done`.
  child.stdin.on('error', () => {});
  let stderr = '';
  child.stderr.on('data', (d) => {
    stderr += d.toString();
    if (stderr.length > 65536) stderr = stderr.slice(-32768);
    if (onStderr) onStderr(d.toString());
  });

  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exited with code ${code}\n${stderr.slice(-2000)}`));
    });
  });

  return { child, done };
}

// High-quality GIF conversion (two-pass palette). Capped fps/width keep the
// file size reasonable.
async function mp4ToGif(inputPath, outputPath, { fps = 15, width = 720 } = {}) {
  await run([
    '-y',
    '-i', inputPath,
    '-vf',
    `fps=${fps},scale=${width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4`,
    '-loop', '0',
    outputPath,
  ]);
}

// Pauses in the recording's audio: [{ start, end }] in source seconds.
// Quiet means below `noiseDb` for at least `minDuration` seconds.
async function detectSilences(file, { noiseDb = -35, minDuration = 1.5 } = {}) {
  if (!(await hasAudioStream(file))) return [];
  return new Promise((resolve, reject) => {
    const child = spawn(
      ffmpegPath(),
      [
        '-hide_banner', '-nostats', '-i', file, '-map', '0:a:0',
        '-af', `silencedetect=noise=${noiseDb}dB:d=${minDuration}`, '-f', 'null', '-',
      ],
      { windowsHide: true }
    );
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', reject);
    child.on('close', () => {
      const out = [];
      let open = null;
      for (const line of stderr.split('\n')) {
        const s = /silence_start: (-?[\d.]+)/.exec(line);
        const e = /silence_end: ([\d.]+)/.exec(line);
        if (s) open = Math.max(0, Number(s[1]));
        if (e && open !== null) {
          out.push({ start: open, end: Number(e[1]) });
          open = null;
        }
      }
      // Silence running to the end of the file has no silence_end line.
      if (open !== null) out.push({ start: open, end: Number.MAX_SAFE_INTEGER });
      resolve(out.slice(0, 10000));
    });
  });
}

module.exports = {
  detectSilences,
  ffmpegPath, run, remuxWebm, probeDurationSeconds, muxNativeRecording, nativeMuxArgs, startRawFrameEncoder, mp4ToGif, atempoChain,
  detectHardwareEncoder, videoCodecArgs, QUALITY_LEVELS, buildAudioGraph, hasAudioStream, voiceFilters, VOICE_MODES,
};
