import React, { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../stores/app-store.js';
import { useEditorStore } from '../../stores/editor-store.js';
import { makeZoomEvent, clampCenter, zoomTypeFor } from '../../engine/zoom-engine.js';
import { canvasPointToVideoUV, ANNOTATION_COLORS } from '../../engine/composition-engine.js';
import { cursorPositionAt } from '../../engine/cursor-track.js';
import { composeFrame, cameraFor, trackFor, fullToCropUV, layoutFor } from '../../engine/frame-state.js';
import { totalDuration, resolve, clipSpeed } from '../../engine/timeline-engine.js';
import { applyAutoZoom } from '../../engine/auto-zoom.js';
import { webcamTimeFor } from '../../engine/export-planner.js';
import { usesCutout } from '../../engine/camera-layout.js';
import { loadPersonSegmenter } from '../../engine/person-mask.js';
import Timeline from '../timeline/Timeline.jsx';
import ExportDialog from '../export/ExportDialog.jsx';
import CommandPalette from './CommandPalette.jsx';
import { drawSafeZones } from './safe-zones.js';
import SidePanel from './SidePanel.jsx';
import PresetsMenu from './PresetsMenu.jsx';
import Menu, { MenuDivider, MenuItem, MenuLabel } from './Menu.jsx';
import { CropFields } from './panels/StylePanel.jsx';
import { ANNOTATION_TOOLS } from './panels/AnnotatePanel.jsx';
import { LAYOUT_OPTIONS } from './panels/CameraPanel.jsx';
import { ASPECTS, EditorActions, FRAMING_OPTIONS, aspectOf } from './editor-context.js';
import {
  ArrowLeftIcon, ChevronDownIcon, CommandIcon, CopyIcon, CropIcon, ExportIcon, FitIcon, PauseIcon, PhoneIcon,
  PlayIcon, PlusIcon, RedoIcon, ScissorsIcon, SkipBackIcon, SkipForwardIcon, UndoIcon, VolumeIcon, VolumeOffIcon,
  WandIcon,
} from '../../ui/icons.jsx';

const MAX_TIMELINE_ZOOM = 12;
const PREVIEW_VOLUME_KEY = 'frameflow.editor.previewVolume';

function loadPreviewVolume() {
  try {
    const v = Number(localStorage.getItem(PREVIEW_VOLUME_KEY));
    return localStorage.getItem(PREVIEW_VOLUME_KEY) != null && v >= 0 && v <= 1 ? v : 1;
  } catch {
    return 1;
  }
}

export default function EditorView() {
  const { openLibrary, editorProjectId } = useAppStore();
  const {
    project,
    setProject,
    currentTime,
    playing,
    setPlaying,
    selectedZoomId,
    selectedAnnotationId,
    updateZoomEvent,
    updateAnnotation,
    addZoomEvent,
    savedState,
    cursorTrack,
    splitAtPlayhead,
    addVideoClip,
  } = useEditorStore();

  // videoRef is the element playing right now: the screen recording
  // (mainVideoRef) or a video added to the timeline as a clip.
  const videoRef = useRef(null);
  const mainVideoRef = useRef(null);
  const addedVideoEls = useRef({}); // asset id -> <video>
  const [addedUrls, setAddedUrls] = useState({}); // asset id -> media URL
  const webcamRef = useRef(null);
  const canvasRef = useRef(null);
  // Playback position: which clip the video element is currently inside.
  // pendingSeek holds the latest scrub target while the video is still
  // seeking; it is applied on 'seeked' so drags never queue up seeks.
  const playbackRef = useRef({ clipIndex: 0, pendingSeek: null });
  const bgImageRef = useRef(null); // { url, image }
  const maskerRef = useRef(null); // person segmenter, loaded once a cutout layout exists
  const musicRef = useRef(null);
  const [musicUrl, setMusicUrl] = useState(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [reelMode, setReelMode] = useState(false);
  const reelRef = useRef(false);
  reelRef.current = reelMode;
  const [toast, setToast] = useState(null);
  const dragRef = useRef(null); // annotation arrow/rect drag in progress
  const [videoUrl, setVideoUrl] = useState(null);
  const [webcamUrl, setWebcamUrl] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const bgVideoRef = useRef(null);
  const [bgVideoUrl, setBgVideoUrl] = useState(null);
  const [timelineZoom, setTimelineZoomRaw] = useState(1);
  const setTimelineZoom = (z) => setTimelineZoomRaw(Math.min(MAX_TIMELINE_ZOOM, Math.max(1, z)));
  // Preview-only listening volume; the export uses the project's volume.
  const [previewVolume, setPreviewVolume] = useState(loadPreviewVolume);
  const [previewMuted, setPreviewMuted] = useState(false);
  const previewGainRef = useRef(1);
  previewGainRef.current = previewMuted ? 0 : previewVolume;

  useEffect(() => {
    try {
      localStorage.setItem(PREVIEW_VOLUME_KEY, String(previewVolume));
    } catch {
      // A convenience only.
    }
  }, [previewVolume]);

  // Load project + cursor track + media URL.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await window.frameflow.projects.load(editorProjectId);
        const cursor = await window.frameflow.projects.readCursor(editorProjectId);
        const screenAsset = p.assets.find((a) => a.type === 'screen-recording');
        const url = await window.frameflow.projects.mediaUrl(p.id, screenAsset.path);
        const webcamAsset = p.assets.find((a) => a.type === 'webcam-recording');
        let camUrl = null;
        if (webcamAsset) {
          camUrl = await window.frameflow.projects.mediaUrl(p.id, webcamAsset.path).catch(() => null);
        }
        if (cancelled) return;
        let autoAdded = 0;
        if (p.autoZoom?.pending) {
          const result = applyAutoZoom(p, cursor);
          p.zoomEvents = result.zoomEvents;
          p.autoZoom = { pending: false, appliedAt: new Date().toISOString() };
          autoAdded = result.added;
          window.frameflow.projects.save(p).catch(() => {});
        }
        playbackRef.current = { clipIndex: 0, pendingSeek: null };
        setProject(p, cursor);
        if (autoAdded > 0) flash(`Auto zoom added ${autoAdded} zoom${autoAdded === 1 ? '' : 's'}`);
        setVideoUrl(url);
        setWebcamUrl(camUrl);
      } catch (err) {
        if (!cancelled) setLoadError(String(err.message || err));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorProjectId]);

  // Keep the background image element in sync with the project style.
  useEffect(() => {
    const rel = project?.style.backgroundImage;
    if (!rel || project.style.background !== 'image') {
      bgImageRef.current = null;
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const url = await window.frameflow.projects.mediaUrl(project.id, rel);
        if (bgImageRef.current?.url === url) return;
        const image = new Image();
        image.src = url;
        image.onload = () => {
          if (!cancelled) bgImageRef.current = { url, image };
        };
      } catch {
        bgImageRef.current = null;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project]);

  const bgVideoPath = project?.style.background === 'video' ? project.style.backgroundVideo : null;
  useEffect(() => {
    if (!bgVideoPath || !project) {
      setBgVideoUrl(null);
      return undefined;
    }
    let cancelled = false;
    window.frameflow.projects
      .mediaUrl(project.id, bgVideoPath)
      .then((url) => !cancelled && setBgVideoUrl(url))
      .catch(() => !cancelled && setBgVideoUrl(null));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgVideoPath, project?.id]);

  const musicPath = project?.style.audio?.music?.path || null;
  useEffect(() => {
    if (!musicPath || !project) {
      setMusicUrl(null);
      return;
    }
    let cancelled = false;
    window.frameflow.projects
      .mediaUrl(project.id, musicPath)
      .then((url) => !cancelled && setMusicUrl(url))
      .catch(() => !cancelled && setMusicUrl(null));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [musicPath, project?.id]);

  // The person segmenter loads the first time the project has a cutout layout.
  const wantsCutout = Boolean(project?.layouts?.some((l) => l.layout === 'cutout'));
  useEffect(() => {
    if (!wantsCutout || maskerRef.current) return;
    let cancelled = false;
    loadPersonSegmenter()
      .then((m) => {
        maskerRef.current = m;
      })
      .catch(() => {
        if (!cancelled) flash('Camera cutout unavailable: the background removal model could not load');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsCutout]);

  const addedKey = project
    ? project.assets.filter((a) => a.type === 'video').map((a) => `${a.id}:${a.path}`).join('|')
    : '';
  useEffect(() => {
    if (!project) return undefined;
    let cancelled = false;
    const assets = project.assets.filter((a) => a.type === 'video');
    Promise.all(
      assets.map((a) =>
        window.frameflow.projects
          .mediaUrl(project.id, a.path)
          .then((url) => [a.id, url])
          .catch(() => null)
      )
    ).then((pairs) => {
      if (!cancelled) setAddedUrls(Object.fromEntries(pairs.filter(Boolean)));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addedKey]);

  // The element that plays a clip: its own video, or the recording.
  function videoElFor(clip) {
    return (clip && addedVideoEls.current[clip.assetId]) || mainVideoRef.current;
  }

  // Make `el` the playing element; the previous one pauses. True if it changed.
  function activateVideo(el) {
    const prev = videoRef.current;
    if (!el || el === prev) return false;
    if (prev) {
      if (!prev.paused) prev.pause();
      el.volume = prev.volume;
    }
    videoRef.current = el;
    return true;
  }

  // Render + playback loop. The <video> element is the clock inside a clip;
  // this loop converts source time to timeline time, hops to the next clip at
  // boundaries, applies clip speed, and composites every animation frame.
  useEffect(() => {
    if (!project || !videoUrl) return;
    const canvas = canvasRef.current;
    if (!mainVideoRef.current || !canvas) return;
    if (!videoRef.current) videoRef.current = mainVideoRef.current;
    const ctx = canvas.getContext('2d');
    let raf;

    const onSeeked = (e) => {
      const pb = playbackRef.current;
      if (pb.pendingSeek && pb.pendingSeek.el === e.target) {
        e.target.currentTime = pb.pendingSeek.sourceTime;
        pb.pendingSeek = null;
      }
    };
    const elements = [mainVideoRef.current, ...Object.values(addedVideoEls.current)].filter(Boolean);
    for (const el of elements) el.addEventListener('seeked', onSeeked);

    const render = () => {
      const state = useEditorStore.getState();
      const proj = state.project;
      const clips = proj.clips;
      const pb = playbackRef.current;
      if (pb.clipIndex >= clips.length) pb.clipIndex = clips.length - 1;
      const clip = clips[pb.clipIndex];
      const clipEnd = clip.start + clip.duration;
      const speed = clipSpeed(clip);
      // Hand over to the element that plays this clip (recording or added video).
      const next = videoElFor(clip);
      if (activateVideo(next) && !pb.pendingSeek) next.currentTime = clip.start;
      const video = videoRef.current;
      const onRecording = video === mainVideoRef.current;

      if (video.playbackRate !== speed) video.playbackRate = speed;

      let timelineTime;
      if (pb.pendingSeek) {
        // A queued scrub target owns the clock until its seek is issued;
        // video.currentTime may still belong to a different clip.
        timelineTime = pb.pendingSeek.t;
      } else {
        // Keep the source position inside the active clip (edits can move it).
        if (video.currentTime < clip.start - 0.05) video.currentTime = clip.start;

        timelineTime =
          clipOffsetOf(clips, pb.clipIndex) +
          (Math.min(video.currentTime, clipEnd) - clip.start) / speed;

        if (video.currentTime >= clipEnd - 0.02 || video.ended) {
          if (pb.clipIndex < clips.length - 1) {
            pb.clipIndex += 1;
            video.currentTime = clips[pb.clipIndex].start;
          } else if (state.playing) {
            video.pause();
            state.setPlaying(false);
            timelineTime = totalDuration(clips);
          }
        }
      }

      // The video can pause on its own while we still want playback, e.g.
      // after it hits its natural end and we hop it back into another clip.
      if (state.playing && video.paused && !video.seeking && !video.ended && video.readyState >= 2) {
        video.play().catch(() => {});
      }

      // Webcam shares the screen recording's clock (shifted by when it
      // started); nudge it back if it drifts.
      const webcam = webcamRef.current;
      if (webcam && !onRecording && !webcam.paused) webcam.pause();
      if (webcam && webcam.readyState >= 2 && onRecording) {
        if (webcam.playbackRate !== speed) webcam.playbackRate = speed;
        const camTarget = webcamTimeFor(proj, video.currentTime);
        if (Math.abs(webcam.currentTime - camTarget) > 0.15) {
          webcam.currentTime = camTarget;
        }
        if (state.playing && webcam.paused && !webcam.ended) webcam.play().catch(() => {});
        if (!state.playing && !webcam.paused) webcam.pause();
      }

      // Background music follows the timeline clock (looping like the export).
      const music = musicRef.current;
      const musicStyle = proj.style.audio?.music;
      if (music && musicStyle && music.readyState >= 1 && music.duration > 0) {
        music.volume = Math.min(1, Math.max(0, musicStyle.volume ?? 0.25)) * previewGainRef.current;
        const target = timelineTime % music.duration;
        if (Math.abs(music.currentTime - target) > 0.3) music.currentTime = target;
        if (state.playing && music.paused) music.play().catch(() => {});
        if (!state.playing && !music.paused) music.pause();
      }

      // A background video loops on the timeline clock, like the export.
      const bgVideo = bgVideoRef.current;
      if (bgVideo && bgVideo.readyState >= 1 && bgVideo.duration > 0) {
        const target = timelineTime % bgVideo.duration;
        const drift = Math.abs(bgVideo.currentTime - target);
        if (drift > (state.playing ? 0.3 : 0.02)) bgVideo.currentTime = target;
        if (state.playing && bgVideo.paused) bgVideo.play().catch(() => {});
        if (!state.playing && !bgVideo.paused) bgVideo.pause();
      }

      const camReady = onRecording && webcam && webcam.readyState >= 2;
      const webcamMask =
        camReady && maskerRef.current && usesCutout(proj.layouts, timelineTime) ? maskerRef.current.maskFor(webcam) : null;

      if (video.readyState >= 2) {
        composeFrame(
          ctx,
          proj,
          state.cursorTrack,
          timelineTime,
          {
            video,
            videoW: video.videoWidth,
            videoH: video.videoHeight,
            canvasW: canvas.width,
            canvasH: canvas.height,
            webcamVideo: camReady ? webcam : null,
            webcamMask,
            backgroundImage: bgImageRef.current?.image || null,
            backgroundVideo: bgVideo && bgVideo.readyState >= 2 ? bgVideo : null,
          },
          // Fewer blur sub-frames while playing keeps the preview at 60 fps;
          // a paused frame renders at export quality.
          { sourceTime: video.currentTime, blurSamples: state.playing ? 4 : 8 }
        );
        // Preview-only guides; the exporter renders on its own canvas.
        if (reelRef.current && canvas.height > canvas.width) drawSafeZones(ctx, canvas.width, canvas.height);
      }
      state.setCurrentTime(timelineTime);
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(raf);
      for (const el of elements) el.removeEventListener('seeked', onSeeked);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, videoUrl, addedUrls]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (playing) {
      // Restarting from the very end rewinds to the beginning.
      const state = useEditorStore.getState();
      if (state.currentTime >= totalDuration(state.project.clips) - 0.05) seek(0);
      videoRef.current.play().catch(() => setPlaying(false));
    } else {
      for (const el of [mainVideoRef.current, ...Object.values(addedVideoEls.current)]) if (el && !el.paused) el.pause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  // Keyboard: space play/pause, S split, Delete removes selection, Ctrl+Z/Y.
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey && e.code === 'KeyK') {
        e.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable) {
        return;
      }
      const s = useEditorStore.getState();
      if (e.code === 'Space') {
        e.preventDefault();
        s.setPlaying(!s.playing);
      } else if (e.code === 'KeyS' && !e.ctrlKey) {
        s.splitAtPlayhead();
      } else if (e.code === 'Delete' || e.code === 'Backspace') {
        if (s.selectedZoomId) s.removeZoomEvent(s.selectedZoomId);
        else if (s.selectedAnnotationId) s.removeAnnotation(s.selectedAnnotationId);
        else if (s.selectedCaptionId) s.removeCaption(s.selectedCaptionId);
        else if (s.selectedLayoutId) s.removeLayout(s.selectedLayoutId);
        else if (s.selectedTransitionId) s.setClipTransition(s.selectedTransitionId, { type: 'none' });
        else if (s.selectedClipId) s.deleteClip(s.selectedClipId);
      } else if (e.ctrlKey && e.code === 'KeyZ' && !e.shiftKey) {
        e.preventDefault();
        s.undo();
      } else if ((e.ctrlKey && e.code === 'KeyY') || (e.ctrlKey && e.shiftKey && e.code === 'KeyZ')) {
        e.preventDefault();
        s.redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function seek(timelineTime) {
    const state = useEditorStore.getState();
    if (!videoRef.current || !state.project) return;
    const clips = state.project.clips;
    const t = Math.min(Math.max(0, timelineTime), totalDuration(clips));
    const hit = resolve(clips, t);
    if (!hit) return;
    const pb = playbackRef.current;
    pb.clipIndex = hit.index;
    activateVideo(videoElFor(hit.clip));
    const video = videoRef.current;
    if (video.seeking) {
      // Scrubbing fires far faster than the decoder can seek; keep only the
      // latest target instead of interrupting the in-flight seek every move.
      pb.pendingSeek = { sourceTime: hit.sourceTime, t, el: video };
    } else {
      pb.pendingSeek = null;
      video.currentTime = hit.sourceTime;
    }
    // The render loop re-syncs the webcam once it drifts; skip it mid-seek.
    const webcam = webcamRef.current;
    if (webcam && !webcam.seeking && video === mainVideoRef.current) webcam.currentTime = webcamTimeFor(state.project, hit.sourceTime);
    state.setCurrentTime(t);
  }

  // Master volume applies to the preview immediately (export reads the same
  // value); the preview volume control scales only what you hear here.
  useEffect(() => {
    if (!project) return;
    const volume = Math.min(1, project.style.volume ?? 1) * (previewMuted ? 0 : previewVolume);
    for (const el of [mainVideoRef.current, ...Object.values(addedVideoEls.current)]) if (el) el.volume = volume;
  }, [project, previewVolume, previewMuted, addedUrls]);

  // Point on the canvas (client coords) -> crop-UV under the current camera.
  function pointToUV(clientX, clientY) {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const state = useEditorStore.getState();
    const rect = canvas.getBoundingClientRect();
    return canvasPointToVideoUV(
      (clientX - rect.left) / rect.width,
      (clientY - rect.top) / rect.height,
      canvas.width,
      canvas.height,
      video.videoWidth,
      video.videoHeight,
      state.project.style,
      cameraFor(state.project, trackFor(state.project, state.cursorTrack), state.currentTime),
      // Camera layouts can move the screen into part of the canvas.
      layoutFor(state.project, state.cursorTrack, state.currentTime, {
        canvasW: canvas.width,
        canvasH: canvas.height,
        videoW: video.videoWidth,
        videoH: video.videoHeight,
      }).screenArea
    );
  }

  // Preview interactions: set zoom focus (click), or place/drag the selected
  // annotation (click for text, drag tail->head for arrows, corner->corner
  // for highlight boxes).
  function onCanvasPointerDown(e) {
    if (!project) return;
    if (selectedZoomId) {
      const uv = pointToUV(e.clientX, e.clientY);
      updateZoomEvent(selectedZoomId, uv);
      return;
    }
    if (selectedAnnotationId) {
      const a = project.annotations.find((x) => x.id === selectedAnnotationId);
      if (!a) return;
      const uv = pointToUV(e.clientX, e.clientY);
      if (a.type === 'text') {
        updateAnnotation(a.id, { x: uv.x, y: uv.y });
        return;
      }
      // Arrow / rect: drag defines both points.
      updateAnnotation(a.id, { x: uv.x, y: uv.y, x2: uv.x, y2: uv.y }, { transient: true });
      dragRef.current = { id: a.id };
      const move = (ev) => {
        const p = pointToUV(ev.clientX, ev.clientY);
        updateAnnotation(a.id, { x2: p.x, y2: p.y }, { transient: true });
      };
      const up = (ev) => {
        const p = pointToUV(ev.clientX, ev.clientY);
        updateAnnotation(a.id, { x2: p.x, y2: p.y });
        dragRef.current = null;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    }
  }

  function addZoomAtPlayhead() {
    if (!project) return;
    const duration = totalDuration(project.clips);
    const t = Math.min(currentTime, Math.max(0, duration - 1.5));
    // Cursor samples live in source-recording time, so map through the clips.
    const hit = resolve(project.clips, t);
    const pos =
      cursorTrack && hit ? cursorPositionAt(cursorTrack.samples, hit.sourceTime) : null;
    const crop = pos ? fullToCropUV(project, pos) : null;
    const focus = crop ? clampCenter(crop.x, crop.y, 1.8) : { cx: 0.5, cy: 0.5 };
    addZoomEvent(
      makeZoomEvent({
        time: t,
        duration: Math.min(3, duration - t),
        x: focus.cx,
        y: focus.cy,
        type: zoomTypeFor(project.style),
      })
    );
  }

  // Add another video file to the timeline as a clip (copied into the project).
  const [addingClip, setAddingClip] = useState(false);
  async function addClipFromFile() {
    if (!project || addingClip) return;
    setAddingClip(true);
    try {
      const asset = await window.frameflow.projects.addClipVideo(project.id);
      if (asset) {
        const at = useEditorStore.getState().currentTime;
        addVideoClip(asset, at);
        flash(`Added "${asset.name}" at ${formatTime(at)}`);
      }
    } catch (err) {
      flash(`Could not add the video: ${String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`);
    } finally {
      setAddingClip(false);
    }
  }

  function flash(message) {
    setToast(message);
    setTimeout(() => setToast((t) => (t === message ? null : t)), 1800);
  }

  // The preview canvas renders at the project's full resolution, so this is
  // the real frame (minus reel-mode guides, which are redrawn next frame).
  async function copyFrame() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const wasReel = reelRef.current;
    reelRef.current = false;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      await window.frameflow.clipboard.writeImage(canvas.toDataURL('image/png'));
      flash('Frame copied to clipboard');
    } catch {
      flash('Could not copy frame');
    } finally {
      reelRef.current = wasReel;
    }
  }

  function addAnnotation(type) {
    const s = useEditorStore.getState();
    const duration = totalDuration(s.project.clips);
    const t = Math.min(s.currentTime, Math.max(0, duration - 1));
    s.addAnnotation({
      id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type,
      time: t,
      duration: Math.min(3, duration - t),
      x: 0.4,
      y: 0.4,
      x2: type === 'text' ? undefined : 0.6,
      y2: type === 'text' ? undefined : 0.55,
      text: type === 'text' ? 'Note' : undefined,
      color: ANNOTATION_COLORS[0],
    });
  }

  function addLayout(type) {
    const s = useEditorStore.getState();
    const duration = totalDuration(s.project.clips);
    const t = Math.min(s.currentTime, Math.max(0, duration - 1));
    s.addLayout({
      id: `layout-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      layout: type,
      time: t,
      duration: Math.min(4, duration - t),
    });
  }

  // Replace the automatic zooms with fresh ones from the clicks; zooms placed
  // or adjusted by hand are kept.
  function runAutoZoom() {
    const s = useEditorStore.getState();
    const track = s.cursorTrack;
    if (!track || (!track.clicks?.length && !track.samples?.length)) {
      flash('No click or cursor data in this recording');
      return;
    }
    let added = 0;
    s.updateProject((p) => {
      const result = applyAutoZoom(p, track);
      p.zoomEvents = result.zoomEvents;
      added = result.added;
      return p;
    });
    flash(added ? `Auto zoom: ${added} zoom${added === 1 ? '' : 's'}` : 'Auto zoom found nothing new to zoom on');
  }

  function commandList() {
    const s = useEditorStore.getState();
    const st = s.project.style;
    const setAnim = (screen) => s.setStyle({ animation: { ...st.animation, screen } });
    return [
      { id: 'play', label: s.playing ? 'Pause' : 'Play', hint: 'Space', run: () => s.setPlaying(!s.playing) },
      { id: 'split', label: 'Split clip at playhead', hint: 'S', run: () => s.splitAtPlayhead() },
      { id: 'zoom', label: 'Add zoom at playhead', run: addZoomAtPlayhead },
      { id: 'auto-zoom', label: 'Auto zoom', hint: 'zoom where you clicked', run: runAutoZoom },
      { id: 'caption', label: 'Add caption at playhead', run: addCaptionAtPlayhead },
      { id: 'text', label: 'Add text annotation', run: () => addAnnotation('text') },
      { id: 'arrow', label: 'Add arrow', run: () => addAnnotation('arrow') },
      { id: 'box', label: 'Add highlight box', run: () => addAnnotation('rect') },
      { id: 'blur', label: 'Add blur mask', hint: 'hide sensitive data', run: () => addAnnotation('blur') },
      { id: 'spot', label: 'Add spotlight', hint: 'dim everything else', run: () => addAnnotation('spotlight') },
      { id: 'undo', label: 'Undo', hint: 'Ctrl+Z', run: () => s.undo() },
      { id: 'redo', label: 'Redo', hint: 'Ctrl+Y', run: () => s.redo() },
      {
        id: 'cursor',
        label: st.cursor?.overlay ? 'Hide smooth cursor' : 'Show smooth cursor',
        run: () => s.setStyle({ cursor: { ...st.cursor, overlay: !st.cursor?.overlay } }),
      },
      { id: 'anim-focused', label: 'Screen animation: Focused', run: () => setAnim('focused') },
      { id: 'anim-smooth', label: 'Screen animation: Smooth', run: () => setAnim('smooth') },
      { id: 'anim-classic', label: 'Screen animation: Classic', run: () => setAnim('classic') },
      { id: 'zoom-classic', label: 'Zoom style: Classic zoom', run: () => s.setZoomStyle('classic') },
      { id: 'zoom-loupe', label: 'Zoom style: Loupe zoom', run: () => s.setZoomStyle('loupe') },
      {
        id: 'blur-toggle',
        label: (st.animation?.motionBlur?.strength || 0) > 0 ? 'Turn motion blur off' : 'Turn motion blur on',
        run: () =>
          s.setStyle({
            animation: {
              ...st.animation,
              motionBlur: { ...st.animation?.motionBlur, strength: (st.animation?.motionBlur?.strength || 0) > 0 ? 0 : 0.5 },
            },
          }),
      },
      ...ASPECTS.map((a) => ({
        id: `canvas-${a.id}`,
        label: `Canvas ${a.label}`,
        hint: a.hint,
        run: () => s.setCanvasSize(a.width, a.height),
      })),
      ...FRAMING_OPTIONS.map((f) => ({
        id: `framing-${f.id}`,
        label: `Screen framing: ${f.label}`,
        hint: f.hint,
        run: () => s.setStyle({ framing: f.id }),
      })),
      { id: 'reel', label: reelRef.current ? 'Hide reel safe zones' : 'Show reel safe zones', hint: '9:16', run: () => setReelMode((r) => !r) },
      { id: 'copy', label: 'Copy current frame as image', run: copyFrame },
      { id: 'export', label: 'Export video…', run: () => setExporting(true) },
      { id: 'library', label: 'Back to library', run: openLibrary },
    ];
  }

  function addCaptionAtPlayhead() {
    if (!project) return;
    const duration = totalDuration(project.clips);
    const t = Math.min(currentTime, Math.max(0, duration - 1));
    useEditorStore.getState().addCaption({
      id: `cap-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      time: t,
      duration: Math.min(3, duration - t),
      text: 'New caption',
    });
  }

  if (loadError) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4">
        <p className="text-red-300">Could not open project: {loadError}</p>
        <button onClick={openLibrary} className="text-indigo-400 hover:text-indigo-300 text-sm">
          ← Back to library
        </button>
      </div>
    );
  }

  if (!project || !videoUrl) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const duration = totalDuration(project.clips);
  const placing = selectedZoomId
    ? 'Click the preview to set the zoom focus point'
    : selectedAnnotationId
      ? 'Click (text) or drag (arrow, box, blur, spotlight) on the preview to place the annotation'
      : null;
  const aspect = aspectOf(project);
  const portrait = project.project.height > project.project.width;
  const hasWebcam = project.assets.some((a) => a.type === 'webcam-recording');
  const actions = {
    seek,
    addZoomAtPlayhead,
    addCaptionAtPlayhead,
    addAnnotation,
    addLayout,
    runAutoZoom,
    copyFrame,
    flash,
  };

  return (
    <EditorActions.Provider value={actions}>
      <div className="flex-1 flex flex-col min-h-0 bg-[#1b1b1b]">
        {/* Top bar */}
        <div className="h-11 shrink-0 grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-2 bg-slate-950 border-b border-black/70">
          <div className="flex items-center gap-1">
            <BarButton onClick={openLibrary} title="Back to the library">
              <ArrowLeftIcon size={15} /> Library
            </BarButton>
            <span className="w-px h-5 bg-slate-800 mx-1" />
            <UndoRedoButtons />
          </div>
          <div className="flex items-center gap-2 min-w-0 justify-center">
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                savedState === 'error' ? 'bg-red-500' : savedState === 'saving' ? 'bg-amber-400' : 'bg-emerald-500'
              }`}
              title={savedState === 'error' ? 'Save failed' : savedState === 'saving' ? 'Saving…' : 'All changes saved'}
            />
            <span className="text-[13px] font-medium text-slate-100 truncate max-w-[420px]">{project.project.name}</span>
            {savedState === 'error' && <span className="text-[11px] text-red-400">Save failed</span>}
          </div>
          <div className="flex items-center gap-1.5 justify-end">
            {toast && <span className="text-[11.5px] text-emerald-300 mr-2 truncate">{toast}</span>}
            <BarButton onClick={() => setPaletteOpen(true)} title="Command menu (Ctrl+K)">
              <CommandIcon size={14} /> <span className="text-slate-500">Ctrl+K</span>
            </BarButton>
            <PresetsMenu />
            <button
              onClick={() => setExporting(true)}
              className="h-8 px-4 rounded-[5px] flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-[12.5px] font-semibold transition-colors"
            >
              <ExportIcon size={14} /> Export
            </button>
          </div>
        </div>

        <div className="flex-1 flex min-h-0">
          <SidePanel />

          {/* Preview */}
          <main className="flex-1 flex flex-col min-w-0">
            <div className="h-10 shrink-0 flex items-center justify-center gap-1 border-b border-black/40">
              <Menu
                align="center"
                width={210}
                trigger={({ open, toggle }) => (
                  <BarButton onClick={toggle} active={open} title="Canvas size">
                    {aspect ? aspect.label : `${project.project.width}×${project.project.height}`}
                    <ChevronDownIcon size={13} className="text-slate-500" />
                  </BarButton>
                )}
              >
                {(close) => (
                  <>
                    {ASPECTS.map((a) => (
                      <MenuItem
                        key={a.id}
                        hint={a.hint}
                        checked={aspect?.id === a.id}
                        onClick={() => {
                          useEditorStore.getState().setCanvasSize(a.width, a.height);
                          close();
                        }}
                      >
                        {a.label}
                      </MenuItem>
                    ))}
                    <MenuDivider />
                    <MenuLabel>Screen framing</MenuLabel>
                    {FRAMING_OPTIONS.map((f) => (
                      <MenuItem
                        key={f.id}
                        hint={f.hint}
                        checked={(project.style.framing || 'auto') === f.id}
                        onClick={() => {
                          useEditorStore.getState().setStyle({ framing: f.id });
                          close();
                        }}
                      >
                        {f.label}
                      </MenuItem>
                    ))}
                  </>
                )}
              </Menu>
              <span className="w-px h-4 bg-slate-800 mx-1" />
              <Menu
                align="center"
                width={250}
                trigger={({ open, toggle }) => (
                  <BarButton onClick={toggle} active={open} title="Crop the recording">
                    <CropIcon size={14} /> Crop
                  </BarButton>
                )}
              >
                <div className="p-2 space-y-2">
                  <CropFields
                    crop={project.style.crop || { l: 0, r: 0, t: 0, b: 0 }}
                    onChange={(c) => useEditorStore.getState().setStyle({ crop: c })}
                  />
                  <button
                    onClick={() => useEditorStore.getState().setStyle({ crop: { l: 0, r: 0, t: 0, b: 0 } })}
                    className="text-[11px] text-indigo-400 hover:text-indigo-300"
                  >
                    Reset crop
                  </button>
                </div>
              </Menu>
              <BarButton onClick={copyFrame} title="Copy the current frame as an image">
                <CopyIcon size={14} /> Copy frame
              </BarButton>
              {portrait && (
                <BarButton
                  onClick={() => setReelMode((r) => !r)}
                  active={reelMode}
                  title="Show where TikTok / Reels / Shorts place their interface (preview only)"
                >
                  <PhoneIcon size={14} /> Safe zones
                </BarButton>
              )}
            </div>
            <div className="flex-1 min-h-0 flex flex-col items-center justify-center p-6">
              <canvas
                ref={canvasRef}
                width={project.project.width}
                height={project.project.height}
                onPointerDown={onCanvasPointerDown}
                className={`max-w-full max-h-full rounded-[3px] shadow-[0_8px_40px_rgba(0,0,0,0.6)] ring-1 ring-black/60 ${
                  placing ? 'cursor-crosshair' : ''
                }`}
              />
              <p className={`text-[11.5px] text-indigo-300 mt-2 h-4 ${placing ? '' : 'invisible'}`}>{placing}</p>
              <video
                ref={(el) => {
                  mainVideoRef.current = el;
                  if (!videoRef.current) videoRef.current = el;
                }}
                src={videoUrl}
                className="hidden"
                preload="auto"
              />
              {Object.entries(addedUrls).map(([id, url]) => (
                <video
                  key={id}
                  ref={(el) => {
                    if (el) addedVideoEls.current[id] = el;
                    else delete addedVideoEls.current[id];
                  }}
                  src={url}
                  className="hidden"
                  preload="auto"
                />
              ))}
              {webcamUrl && <video ref={webcamRef} src={webcamUrl} muted className="hidden" preload="auto" />}
              {bgVideoUrl && <video ref={bgVideoRef} src={bgVideoUrl} muted loop className="hidden" preload="auto" />}
              {musicUrl && <audio ref={musicRef} src={musicUrl} preload="auto" />}
            </div>
          </main>
        </div>

        {/* Toolbar + timeline */}
        <div className="shrink-0 bg-slate-900 border-t border-black/70">
          <div className="h-11 grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-2 border-b border-black/50">
            <div className="flex items-center gap-1">
              <Menu
                placement="above"
                width={230}
                trigger={({ open, toggle }) => (
                  <button
                    onClick={toggle}
                    className={`h-8 pl-2.5 pr-2 rounded-[5px] flex items-center gap-1.5 text-[12.5px] font-medium border transition-colors ${
                      open ? 'bg-indigo-600 border-indigo-500 text-white' : 'border-indigo-500/60 text-indigo-300 hover:bg-indigo-600/15'
                    }`}
                  >
                    <PlusIcon size={14} /> Add layer
                    <ChevronDownIcon size={13} />
                  </button>
                )}
              >
                {(close) => {
                  const run = (fn) => () => {
                    fn();
                    close();
                  };
                  return (
                    <>
                      <MenuItem hint="Another video" onClick={run(addClipFromFile)}>
                        Video clip…
                      </MenuItem>
                      <MenuDivider />
                      <MenuItem onClick={run(addZoomAtPlayhead)}>Zoom</MenuItem>
                      <MenuItem onClick={run(addCaptionAtPlayhead)}>Caption</MenuItem>
                      <MenuDivider />
                      {ANNOTATION_TOOLS.map((t) => (
                        <MenuItem key={t.type} hint={t.hint} onClick={run(() => addAnnotation(t.type))}>
                          {t.label}
                        </MenuItem>
                      ))}
                      {hasWebcam && (
                        <>
                          <MenuDivider />
                          {LAYOUT_OPTIONS.map((l) => (
                            <MenuItem key={l.id} hint="Camera layout" onClick={run(() => addLayout(l.id))}>
                              {l.label}
                            </MenuItem>
                          ))}
                        </>
                      )}
                    </>
                  );
                }}
              </Menu>
              <ToolButton onClick={runAutoZoom} title="Auto zoom: add zooms where you clicked">
                <WandIcon size={15} />
              </ToolButton>
              <ToolButton onClick={splitAtPlayhead} title="Split the clip at the playhead (S)">
                <ScissorsIcon size={15} />
              </ToolButton>
            </div>

            <div className="flex items-center gap-1">
              <span className="text-[11.5px] tabular-nums text-slate-300 w-14 text-right">{formatTime(currentTime)}</span>
              <ToolButton onClick={() => seek(0)} title="Go to start">
                <SkipBackIcon size={14} />
              </ToolButton>
              <button
                onClick={() => setPlaying(!playing)}
                className="w-9 h-9 rounded-full bg-slate-100 hover:bg-white text-slate-950 flex items-center justify-center"
                title="Play/pause (Space)"
              >
                {playing ? <PauseIcon size={15} /> : <PlayIcon size={15} className="ml-0.5" />}
              </button>
              <ToolButton onClick={() => seek(duration)} title="Go to end">
                <SkipForwardIcon size={14} />
              </ToolButton>
              <span className="text-[11.5px] tabular-nums text-slate-500 w-14">{formatTime(duration)}</span>
            </div>

            <div className="flex items-center gap-2 justify-end">
              <ToolButton onClick={() => setPreviewMuted((m) => !m)} title={previewMuted ? 'Unmute preview' : 'Mute preview'}>
                {previewMuted || previewVolume === 0 ? <VolumeOffIcon size={15} /> : <VolumeIcon size={15} />}
              </ToolButton>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={previewMuted ? 0 : previewVolume}
                onChange={(e) => {
                  setPreviewVolume(Number(e.target.value));
                  setPreviewMuted(false);
                }}
                title="Preview volume (does not change the export)"
                className="ff-range w-20"
                style={{ '--fill': `${(previewMuted ? 0 : previewVolume) * 100}%` }}
              />
              <span className="w-px h-5 bg-slate-800 mx-1" />
              <ToolButton onClick={() => setTimelineZoom(1)} title="Fit the timeline">
                <FitIcon size={14} />
              </ToolButton>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={Math.log(timelineZoom) / Math.log(MAX_TIMELINE_ZOOM)}
                onChange={(e) => setTimelineZoom(Math.pow(MAX_TIMELINE_ZOOM, Number(e.target.value)))}
                title="Timeline zoom (Ctrl+wheel)"
                className="ff-range w-24"
                style={{ '--fill': `${(Math.log(timelineZoom) / Math.log(MAX_TIMELINE_ZOOM)) * 100}%` }}
              />
              <span className="text-[11px] tabular-nums text-slate-400 w-10">{Math.round(timelineZoom * 100)}%</span>
            </div>
          </div>
          <Timeline
            duration={duration}
            onSeek={seek}
            zoom={timelineZoom}
            onZoomChange={setTimelineZoom}
            onAddClip={addClipFromFile}
            addingClip={addingClip}
          />
        </div>

        {exporting && <ExportDialog videoUrl={videoUrl} webcamUrl={webcamUrl} onClose={() => setExporting(false)} />}
        {paletteOpen && <CommandPalette commands={commandList()} onClose={() => setPaletteOpen(false)} />}
      </div>
    </EditorActions.Provider>
  );
}

function BarButton({ children, onClick, title, active }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`h-8 px-2.5 rounded-[5px] flex items-center gap-1.5 text-[12.5px] transition-colors ${
        active ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}

function ToolButton({ children, onClick, title, disabled }) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className="w-8 h-8 rounded-[5px] flex items-center justify-center text-slate-300 hover:bg-slate-800 hover:text-white disabled:opacity-30 disabled:pointer-events-none transition-colors"
    >
      {children}
    </button>
  );
}

function UndoRedoButtons() {
  const undoStack = useEditorStore((s) => s.undoStack);
  const redoStack = useEditorStore((s) => s.redoStack);
  const { undo, redo } = useEditorStore.getState();
  return (
    <>
      <ToolButton onClick={undo} disabled={undoStack.length === 0} title="Undo (Ctrl+Z)">
        <UndoIcon size={15} />
      </ToolButton>
      <ToolButton onClick={redo} disabled={redoStack.length === 0} title="Redo (Ctrl+Y)">
        <RedoIcon size={15} />
      </ToolButton>
    </>
  );
}

function clipOffsetOf(clips, index) {
  let t = 0;
  for (let i = 0; i < index; i++) t += clips[i].duration / clipSpeed(clips[i]);
  return t;
}

function formatTime(t) {
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
}
