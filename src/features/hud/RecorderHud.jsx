import React, { useEffect, useRef, useState } from 'react';
import {
  AreaIcon,
  CameraIcon,
  CameraOffIcon,
  CheckIcon,
  ChevronDownIcon,
  CloseIcon,
  FolderIcon,
  MicIcon,
  MicOffIcon,
  MinusIcon,
  MonitorIcon,
  MoreIcon,
  NotesIcon,
  PauseIcon,
  PlayIcon,
  RecordIcon,
  RefreshIcon,
  SpeakerIcon,
  TimerIcon,
  TrashIcon,
  UploadIcon,
  WindowIcon,
} from '../../ui/icons.jsx';
import LogoMark from '../../ui/LogoMark.jsx';

// The floating recorder panel — Frame Studio's home window. Pick a screen/window,
// microphone, webcam and countdown, then record via getDisplayMedia +
// MediaRecorder (system audio arrives as Windows loopback through the
// main-process display-media handler). On stop the main process builds the
// project and the main window opens it in the editor.
//
// The window is a fixed, mostly transparent rectangle with the panel at its
// bottom; menus open upward inside it. Empty areas are click-through
// (hud:set-interactive), so nothing resizes when a menu opens. It is
// excluded from screen capture, so it never appears in its own recordings.

const BAR_TOP = 102; // window bottom -> top edge of the panel
const POPOVER_GAP = 8;
const PREFS_KEY = 'frameflow.recorder';
const COUNTDOWNS = [0, 3, 5, 10];
const NOTES_KEY = 'frameflow.recorder.notes';
const WINDOW_SIZES = [
  [1280, 720], [1920, 1080], [2560, 1440], [1440, 900], [1280, 800], [1080, 1080],
];

function loadNotes() {
  try {
    return localStorage.getItem(NOTES_KEY) || '';
  } catch {
    return '';
  }
}

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
  } catch {
    return {};
  }
}

function savePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Preferences are a convenience; recording works without them.
  }
}

export default function RecorderHud() {
  const [prefs] = useState(loadPrefs);

  const [phase, setPhase] = useState('setup'); // setup | countdown | recording | saving
  const [sources, setSources] = useState([]);
  const [sourceId, setSourceId] = useState(null);
  const [mics, setMics] = useState([]);
  const [micId, setMicId] = useState(prefs.micId ?? null); // null until devices are known
  const [cams, setCams] = useState([]);
  const [camId, setCamId] = useState(prefs.camId ?? 'none');
  const [systemAudio, setSystemAudio] = useState(prefs.systemAudio ?? true);
  const [countdownSecs, setCountdownSecs] = useState(
    COUNTDOWNS.includes(prefs.countdown) ? prefs.countdown : 3
  );
  const [micLevel, setMicLevel] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState(null);
  const [area, setArea] = useState(null); // { x, y, w, h } of the display, or null
  const [shortcut, setShortcut] = useState(null); // { accelerator, registered }
  const [popover, setPopover] = useState(null); // { kind, anchorX }
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [importing, setImporting] = useState(false);
  const [notes, setNotes] = useState(loadNotes);
  const [showNotes, setShowNotes] = useState(prefs.showNotes ?? false);
  const [notesSize, setNotesSize] = useState(prefs.notesSize ?? 15);
  const [hideIcons, setHideIcons] = useState(prefs.hideIcons ?? false);
  const [resizeNote, setResizeNote] = useState(null);

  const sessionRef = useRef(null); // { recorder, camRecorder, queues, streams, timer, ... }
  const countdownCancelRef = useRef(false);
  // Latest handlers for the global shortcut (registered once).
  const actionsRef = useRef({});
  const meterRef = useRef(null); // { ctx, raf, stream }
  const camPreviewRef = useRef(null);
  const rootRef = useRef(null);

  async function refreshSources() {
    try {
      const list = await window.frameflow.recording.listSources();
      list.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'screen' ? -1 : 1));
      setSources(list);
      setSourceId((current) =>
        list.some((s) => s.id === current)
          ? current
          : list.find((s) => s.kind === 'screen')?.id || list[0]?.id || null
      );
    } catch (err) {
      setError(`Could not list capture sources: ${err.message || err}`);
    }
  }

  async function refreshDevices() {
    try {
      // Labels require one granted audio permission.
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
      probe.getTracks().forEach((t) => t.stop());
    } catch {
      // No microphone or permission denied — recording without mic still works.
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications');
      const videos = devices.filter((d) => d.kind === 'videoinput');
      setMics(inputs);
      setCams(videos);
      setMicId((current) =>
        current === 'none' || inputs.some((m) => m.deviceId === current)
          ? current
          : inputs[0]?.deviceId || 'none'
      );
      setCamId((current) => (videos.some((c) => c.deviceId === current) ? current : 'none'));
    } catch {
      setMics([]);
      setCams([]);
      setMicId((current) => current ?? 'none');
    }
  }

  useEffect(() => {
    refreshSources();
    refreshDevices();
    window.frameflow.recording.shortcutStatus().then(setShortcut).catch(() => {});
    // Ctrl+Alt+R from anywhere: start from setup, stop while recording.
    const off = window.frameflow.recording.onShortcut(() => {
      const a = actionsRef.current;
      if (a.phase === 'setup') a.startRecording();
      else if (a.phase === 'countdown') a.cancelCountdown();
      else if (a.phase === 'recording') a.stopRecording();
    });
    const onBlur = () => setPopover(null);
    window.addEventListener('blur', onBlur);
    return () => {
      off();
      window.removeEventListener('blur', onBlur);
      stopMeter();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (micId === null) return;
    savePrefs({ micId, camId, systemAudio, countdown: countdownSecs, showNotes, notesSize, hideIcons });
  }, [micId, camId, systemAudio, countdownSecs, showNotes, notesSize, hideIcons]);

  useEffect(() => {
    try {
      localStorage.setItem(NOTES_KEY, notes);
    } catch {
      // Notes still work for this session.
    }
  }, [notes]);

  // Click-through wherever the window is transparent: the root element is
  // only hit when the pointer is over empty space.
  useEffect(() => {
    let interactive = null;
    const onMove = (e) => {
      const want = e.target !== rootRef.current;
      if (want === interactive) return;
      interactive = want;
      window.frameflow.hud.setInteractive(want).catch(() => {});
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  useEffect(() => {
    if (!popover) return undefined;
    const onKey = (e) => e.key === 'Escape' && setPopover(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [popover]);

  // Live mic level, only while the microphone menu is open.
  useEffect(() => {
    stopMeter();
    if (popover?.kind !== 'mic' || !micId || micId === 'none') return undefined;
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: { exact: micId } },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          analyser.getByteTimeDomainData(data);
          let peak = 0;
          for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
          setMicLevel(peak);
          meterRef.current.raf = requestAnimationFrame(tick);
        };
        meterRef.current = { ctx, stream, raf: requestAnimationFrame(tick) };
      } catch {
        setMicLevel(0);
      }
    })();
    return () => {
      cancelled = true;
      stopMeter();
    };
  }, [micId, popover?.kind]);

  function stopMeter() {
    const m = meterRef.current;
    if (!m) return;
    cancelAnimationFrame(m.raf);
    m.stream?.getTracks().forEach((t) => t.stop());
    m.ctx?.close().catch(() => {});
    meterRef.current = null;
    setMicLevel(0);
  }

  // Live webcam preview, only while the camera menu is open.
  useEffect(() => {
    if (popover?.kind !== 'camera' || camId === 'none') return undefined;
    let stream = null;
    let cancelled = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: camId }, width: 320 },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (camPreviewRef.current) {
          camPreviewRef.current.srcObject = stream;
          camPreviewRef.current.play().catch(() => {});
        }
      } catch {
        setCamId('none');
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [camId, popover?.kind]);

  function togglePopover(kind, e) {
    setError(null);
    if (popover?.kind === kind) {
      setPopover(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    setPopover({ kind, anchorX: rect.left + rect.width / 2 });
    if (kind === 'source') refreshSources();
    if (kind === 'mic' || kind === 'camera') refreshDevices();
  }

  function pickSource(id) {
    if (id !== sourceId) setArea(null);
    setSourceId(id);
    setResizeNote(null);
    // A window stays open in the menu so its resize sizes are right there.
    if (sources.find((s) => s.id === id)?.kind !== 'window') setPopover(null);
  }

  async function chooseArea() {
    setPopover(null);
    setError(null);
    try {
      await window.frameflow.recording.selectSource(sourceId);
      const picked = await window.frameflow.recording.selectArea();
      if (picked) setArea(picked);
    } catch (err) {
      setError(String(err.message || err));
    }
  }

  // Resize the selected window so the recording comes out at an exact size.
  async function resizeWindow(width, height) {
    setResizeNote({ busy: true });
    try {
      await window.frameflow.recording.selectSource(sourceId);
      const r = await window.frameflow.tools.resizeWindow(width, height);
      setResizeNote({ text: r.width === width && r.height === height ? `Window is now ${r.width}×${r.height}` : `Window is ${r.width}×${r.height} (it has a size limit)` });
    } catch (err) {
      setResizeNote({ text: String(err.message || err), error: true });
    }
  }

  // Desktop icons are hidden just before recording and shown again after;
  // icons the user had hidden themselves are left alone (main process).
  function setDesktopIcons(hidden) {
    if (!hideIcons && hidden) return Promise.resolve();
    return window.frameflow.tools.desktopIcons(hidden).catch(() => {});
  }

  async function clearArea() {
    setArea(null);
    await window.frameflow.recording.clearArea().catch(() => {});
  }

  async function importVideo() {
    setPopover(null);
    setImporting(true);
    setError(null);
    try {
      const project = await window.frameflow.projects.importVideo();
      if (project) await window.frameflow.app.openMain({ view: 'editor', projectId: project.id });
    } catch (err) {
      setError(`Import failed: ${err.message || err}`);
    } finally {
      setImporting(false);
    }
  }

  function cancelCountdown() {
    countdownCancelRef.current = true;
  }

  async function startRecording() {
    setError(null);
    setPopover(null);
    setConfirmDiscard(false);
    if (!sourceId) {
      setError('Select a screen or window first.');
      return;
    }
    // Recording always runs from the bar; get the editor out of the way.
    window.frameflow.app.showRecorder().catch(() => {});
    try {
      await window.frameflow.recording.selectSource(sourceId);
    } catch (err) {
      setError(String(err.message || err));
      refreshSources();
      return;
    }

    stopMeter();
    if (countdownSecs > 0) {
      countdownCancelRef.current = false;
      setPhase('countdown');
      for (let i = countdownSecs; i >= 1; i--) {
        setCountdown(i);
        await new Promise((r) => setTimeout(r, 1000));
        if (countdownCancelRef.current) {
          setPhase('setup');
          return;
        }
      }
    }

    // Screens record cursor-free through native capture (Windows) so the
    // editor can draw its own cursor; windows, or machines where that is
    // unavailable, record through Chromium with the system cursor included.
    await setDesktopIcons(true);
    let native = false;
    try {
      native = Boolean((await window.frameflow.recording.captureMode()).native);
    } catch {
      native = false;
    }
    try {
      await beginSession(native);
    } catch (err) {
      let failure = err;
      if (native) {
        try {
          await beginSession(false);
          return;
        } catch (fallbackErr) {
          failure = fallbackErr;
        }
      }
      await window.frameflow.recording.discard().catch(() => {});
      setDesktopIcons(false);
      setError(`Could not start recording: ${failure.message || failure}`);
      setPhase('setup');
    }
  }

  // Acquire streams, open the pending session, start the recorders. Cleans up
  // its own streams when it fails.
  async function beginSession(native) {
    const streams = [];
    let audioCtx = null;
    try {
      // getDisplayMedia is resolved by the main process to the selected source
      // and carries the system (loopback) audio. With native capture only that
      // audio is used, so the video is requested tiny and slow.
      let displayStream = null;
      if (!native || systemAudio) {
        displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: native ? { frameRate: 1, width: 320 } : { frameRate: 30, cursor: 'never' },
          audio: systemAudio,
        });
        streams.push(displayStream);
      }
      const cursorHidden = native || displayStream?.getVideoTracks()[0]?.getSettings().cursor === 'never';

      let micStream = null;
      if (micId && micId !== 'none') {
        try {
          micStream = await navigator.mediaDevices.getUserMedia({
            audio: { deviceId: { exact: micId }, echoCancellation: false, noiseSuppression: true },
          });
          streams.push(micStream);
        } catch {
          // Record without mic rather than failing the whole session.
        }
      }

      // Mix system + mic audio into one track.
      const audioTracks = [];
      const sourcesToMix = [displayStream, micStream].filter((s) => s && s.getAudioTracks().length > 0);
      if (sourcesToMix.length > 0) {
        audioCtx = new AudioContext();
        const dest = audioCtx.createMediaStreamDestination();
        for (const s of sourcesToMix) audioCtx.createMediaStreamSource(s).connect(dest);
        audioTracks.push(...dest.stream.getAudioTracks());
      }

      // Chunks stream straight to disk in the main process (crash-safe); the
      // per-track promise chain keeps appends strictly ordered.
      const queues = { screen: Promise.resolve(), webcam: Promise.resolve(), audio: Promise.resolve() };
      const enqueueChunk = (which, blobChunk) => {
        queues[which] = queues[which]
          .then(async () => {
            const buf = await blobChunk.arrayBuffer();
            if (buf.byteLength > 0) await window.frameflow.recording.chunk(which, buf);
          })
          .catch((err) => console.error('chunk write failed', err));
      };

      let recorder = null;
      let mimeType;
      if (native) {
        // Video is captured by the main process; record the audio alone.
        if (audioTracks.length > 0) {
          mimeType = ['audio/webm;codecs=opus', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported(t));
          recorder = new MediaRecorder(new MediaStream(audioTracks), { mimeType, audioBitsPerSecond: 192_000 });
          recorder.ondataavailable = (e) => e.data && e.data.size > 0 && enqueueChunk('audio', e.data);
        }
      } else {
        mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((t) =>
          MediaRecorder.isTypeSupported(t)
        );
        recorder = new MediaRecorder(new MediaStream([displayStream.getVideoTracks()[0], ...audioTracks]), {
          mimeType,
          videoBitsPerSecond: 12_000_000,
        });
        recorder.ondataavailable = (e) => e.data && e.data.size > 0 && enqueueChunk('screen', e.data);
      }

      // Optional webcam: a separate recorder started alongside the others.
      let camRecorder = null;
      if (camId !== 'none') {
        let camStream = null;
        try {
          camStream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: camId }, width: 1280, height: 720, frameRate: 30 },
          });
          streams.push(camStream);
          camRecorder = new MediaRecorder(camStream, {
            mimeType: ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((t) =>
              MediaRecorder.isTypeSupported(t)
            ),
            videoBitsPerSecond: 5_000_000,
          });
          camRecorder.ondataavailable = (e) => e.data && e.data.size > 0 && enqueueChunk('webcam', e.data);
        } catch {
          camStream?.getTracks().forEach((t) => t.stop());
          camRecorder = null;
        }
      }

      // Opens the crash-safe pending session (and, for native capture, waits
      // until screen frames are flowing) before any chunk can arrive.
      await window.frameflow.recording.begin({ native });

      const session = {
        native,
        recorder,
        camRecorder,
        queues,
        audioCtx,
        streams,
        recordedMs: 0, // accumulated while not paused
        lastResumeAt: Date.now(),
        pausedFlag: false,
        timer: null,
        mimeType,
        cursorHidden,
      };
      sessionRef.current = session;

      // If the user stops sharing from the OS UI, finish the recording cleanly.
      if (!native) {
        displayStream.getVideoTracks()[0].addEventListener('ended', () => {
          if (sessionRef.current === session && recorder.state !== 'inactive') stopRecording();
        });
      }

      // Start the recorders; native capture aligns them to the video clock
      // using the moment each one actually started.
      const startedAt = {};
      const startRecorder = (r, key) =>
        new Promise((resolve) => {
          r.addEventListener(
            'start',
            () => {
              startedAt[key] = Date.now();
              resolve();
            },
            { once: true }
          );
          r.start(1000);
        });
      await Promise.all([
        recorder && startRecorder(recorder, 'audio'),
        camRecorder && startRecorder(camRecorder, 'webcam'),
      ]);
      if (native) await window.frameflow.recording.mediaStarted(startedAt);

      session.lastResumeAt = Date.now();
      session.timer = setInterval(() => {
        const live = session.pausedFlag ? 0 : Date.now() - session.lastResumeAt;
        setElapsed(Math.floor((session.recordedMs + live) / 1000));
      }, 250);
      setElapsed(0);
      setPaused(false);
      setPhase('recording');
    } catch (err) {
      streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
      audioCtx?.close().catch(() => {});
      if (sessionRef.current?.streams === streams) sessionRef.current = null;
      throw err;
    }
  }

  // Native capture keeps every stream running through a pause (the main
  // process turns the pause into a cut); MediaRecorder sessions pause.
  async function togglePause() {
    const session = sessionRef.current;
    if (!session) return;
    const recorders = session.native ? [] : [session.recorder, session.camRecorder].filter(Boolean);
    if (session.pausedFlag) {
      recorders.forEach((r) => r.state === 'paused' && r.resume());
      await window.frameflow.recording.resume().catch(() => {});
      session.lastResumeAt = Date.now();
      session.pausedFlag = false;
      setPaused(false);
    } else {
      recorders.forEach((r) => r.state === 'recording' && r.pause());
      await window.frameflow.recording.pause().catch(() => {});
      session.recordedMs += Date.now() - session.lastResumeAt;
      session.pausedFlag = true;
      setPaused(true);
    }
  }

  function releaseSession(session) {
    clearInterval(session.timer);
    session.streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    session.audioCtx?.close().catch(() => {});
  }

  async function stopRecording() {
    const session = sessionRef.current;
    if (!session) return;
    sessionRef.current = null;
    clearInterval(session.timer);
    setConfirmDiscard(false);
    setPhase('saving');

    const approxDuration =
      (session.recordedMs + (session.pausedFlag ? 0 : Date.now() - session.lastResumeAt)) / 1000;

    try {
      setDesktopIcons(false);
      const stops = [session.recorder, session.camRecorder]
        .filter((r) => r && r.state !== 'inactive')
        .map(
          (r) =>
            new Promise((resolve) => {
              r.addEventListener('stop', resolve, { once: true });
              r.stop();
            })
        );
      await Promise.all(stops);
      releaseSession(session);

      // Wait for the last chunks to land on disk, then finalize.
      await Promise.all(Object.values(session.queues));

      const micLabel =
        micId && micId !== 'none'
          ? mics.find((m) => m.deviceId === micId)?.label || 'Microphone'
          : null;

      const project = await window.frameflow.recording.finalize({
        mimeType: session.mimeType,
        approxDuration,
        micLabel,
        systemAudio,
        cursorHidden: session.cursorHidden,
      });
      setPhase('setup');
      setArea(null);
      await window.frameflow.app.openMain({ view: 'editor', projectId: project.id });
    } catch (err) {
      setError(`Could not save recording: ${err.message || err}`);
      setPhase('setup');
      refreshSources();
    }
  }

  async function discardRecording() {
    const session = sessionRef.current;
    if (!session) return;
    sessionRef.current = null;
    setConfirmDiscard(false);
    for (const r of [session.recorder, session.camRecorder]) {
      if (r && r.state !== 'inactive') {
        r.ondataavailable = null;
        r.stop();
      }
    }
    releaseSession(session);
    setDesktopIcons(false);
    await Promise.all(Object.values(session.queues)).catch(() => {});
    await window.frameflow.recording.discard().catch(() => {});
    setPaused(false);
    setElapsed(0);
    setPhase('setup');
  }

  actionsRef.current = { phase, startRecording, stopRecording, cancelCountdown };

  const selected = sources.find((s) => s.id === sourceId) || null;
  const screens = sources.filter((s) => s.kind === 'screen');
  const windows = sources.filter((s) => s.kind === 'window');
  const sourceLabel = !selected ? 'Choose source' : area ? `Area of ${selected.name}` : selected.name;
  const micOn = Boolean(micId) && micId !== 'none';
  const camOn = camId !== 'none';

  let status;
  let body;
  if (phase === 'countdown') {
    status = <span className="text-indigo-300">Starting in {countdown}</span>;
    body = (
      <>
        <div className="flex items-center gap-3 px-2 min-w-[250px]">
          <span key={countdown} className="text-[32px] leading-none font-light tabular-nums text-slate-50 hud-pop">
            {countdown}
          </span>
          <span className="text-[12px] leading-snug text-slate-400">
            Get ready. Recording
            <br />
            starts automatically.
          </span>
        </div>
        <Separator />
        <SecondaryButton onClick={cancelCountdown}>Cancel</SecondaryButton>
      </>
    );
  } else if (phase === 'recording') {
    status = paused ? (
      <span className="text-amber-400">Paused</span>
    ) : (
      <span className="flex items-center gap-1.5 text-red-400">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
        Recording
      </span>
    );
    body = (
      <>
        <div className="px-2 min-w-[132px]">
          <div className="font-mono text-[22px] leading-none tabular-nums text-slate-50">
            {formatTimecode(elapsed)}
          </div>
          <div className="mt-1.5 text-[10px] uppercase tracking-[0.08em] text-slate-500 truncate max-w-[150px]">
            {sourceLabel}
          </div>
        </div>
        <Separator />
        <Tile label="Notes" title="Speaker notes (not recorded)" active={showNotes} off={!showNotes} onClick={() => setShowNotes((v) => !v)}>
          <NotesIcon />
        </Tile>
        <Tile label={paused ? 'Resume' : 'Pause'} onClick={togglePause}>
          {paused ? <PlayIcon /> : <PauseIcon />}
        </Tile>
        {confirmDiscard ? (
          <Tile label="Confirm" danger onClick={discardRecording} onBlur={() => setConfirmDiscard(false)} autoFocus>
            <TrashIcon />
          </Tile>
        ) : (
          <Tile label="Discard" onClick={() => setConfirmDiscard(true)}>
            <TrashIcon />
          </Tile>
        )}
        <Separator />
        <RecordButton
          onClick={stopRecording}
          title={shortcut?.registered ? 'Stop recording (Ctrl+Alt+R)' : 'Stop recording'}
        >
          <span className="w-2.5 h-2.5 rounded-[2px] bg-white" />
          Stop
        </RecordButton>
      </>
    );
  } else if (phase === 'saving') {
    status = <span className="text-indigo-300">Saving</span>;
    body = (
      <div className="flex flex-col gap-2 px-2 w-[320px]">
        <span className="text-[12px] text-slate-300">Saving recording…</span>
        <div className="h-1 rounded-full bg-slate-800 overflow-hidden">
          <div className="h-full w-1/3 rounded-full bg-indigo-500 hud-indeterminate" />
        </div>
      </div>
    );
  } else {
    status = <span className="text-slate-500">Ready</span>;
    body = (
      <>
        <div className="px-1">
          <div className="mb-1 text-[10px] uppercase tracking-[0.08em] text-slate-500">Source</div>
          <button
            onClick={(e) => togglePopover('source', e)}
            className={`no-drag flex items-center gap-2 w-[178px] h-8 pl-2 pr-1.5 rounded-[5px] border bg-slate-950 transition-colors ${
              popover?.kind === 'source' ? 'border-indigo-500' : 'border-slate-700 hover:border-slate-500'
            }`}
            title="Choose what to record"
          >
            <span className="text-slate-400">
              {area ? (
                <AreaIcon size={15} />
              ) : selected?.kind === 'window' ? (
                <WindowIcon size={15} />
              ) : (
                <MonitorIcon size={15} />
              )}
            </span>
            <span className="flex-1 text-left text-[12.5px] text-slate-100 truncate">{sourceLabel}</span>
            <ChevronDownIcon size={14} className="text-slate-500" />
          </button>
        </div>
        <Separator />
        <Tile
          label={micOn ? 'Mic' : 'Mic off'}
          title="Microphone and system audio"
          active={popover?.kind === 'mic'}
          off={!micOn}
          onClick={(e) => togglePopover('mic', e)}
        >
          {micOn ? <MicIcon /> : <MicOffIcon />}
        </Tile>
        <Tile
          label={camOn ? 'Camera' : 'Cam off'}
          title="Webcam"
          active={popover?.kind === 'camera'}
          off={!camOn}
          onClick={(e) => togglePopover('camera', e)}
        >
          {camOn ? <CameraIcon /> : <CameraOffIcon />}
        </Tile>
        <Tile label="Notes" title="Speaker notes (only you can see them)" active={showNotes} off={!showNotes} onClick={() => setShowNotes((v) => !v)}>
          <NotesIcon />
        </Tile>
        <Tile
          label={countdownSecs ? `${countdownSecs}s delay` : 'No delay'}
          title="Countdown before recording"
          active={popover?.kind === 'timer'}
          off={!countdownSecs}
          onClick={(e) => togglePopover('timer', e)}
        >
          <TimerIcon />
        </Tile>
        <Separator />
        <RecordButton
          onClick={startRecording}
          disabled={!sourceId}
          title={shortcut?.registered ? 'Start recording (Ctrl+Alt+R)' : 'Start recording'}
        >
          <RecordIcon size={16} />
          Record
        </RecordButton>
      </>
    );
  }

  let overlay = null;
  if (popover && phase === 'setup') {
    const content = {
      source: (
        <SourceMenu
          screens={screens}
          windows={windows}
          sourceId={sourceId}
          area={area}
          onPick={pickSource}
          onRefresh={refreshSources}
          onChooseArea={chooseArea}
          onClearArea={clearArea}
          onResizeWindow={resizeWindow}
          resizeNote={resizeNote}
        />
      ),
      mic: (
        <>
          <MenuLabel>Microphone</MenuLabel>
          <MenuItem checked={micId === 'none'} onClick={() => setMicId('none')}>
            No microphone
          </MenuItem>
          {mics.map((m) => (
            <MenuItem key={m.deviceId} checked={micId === m.deviceId} onClick={() => setMicId(m.deviceId)}>
              {m.label || 'Microphone'}
            </MenuItem>
          ))}
          {micOn && <LevelMeter level={micLevel} />}
          <MenuDivider />
          <button
            onClick={() => setSystemAudio((v) => !v)}
            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-[4px] hover:bg-slate-800 text-left"
          >
            <SpeakerIcon size={15} className="text-slate-400" />
            <span className="flex-1">
              <span className="block text-slate-100">System audio</span>
              <span className="block text-[11px] text-slate-500">Record what you hear</span>
            </span>
            <Switch on={systemAudio} />
          </button>
        </>
      ),
      camera: (
        <>
          <MenuLabel>Camera</MenuLabel>
          <MenuItem checked={camId === 'none'} onClick={() => setCamId('none')}>
            No camera
          </MenuItem>
          {cams.map((c) => (
            <MenuItem key={c.deviceId} checked={camId === c.deviceId} onClick={() => setCamId(c.deviceId)}>
              {c.label || 'Camera'}
            </MenuItem>
          ))}
          {camOn && (
            <div className="m-1.5 mt-2 rounded-[5px] overflow-hidden border border-slate-700 bg-black aspect-video">
              <video ref={camPreviewRef} muted playsInline className="w-full h-full object-cover" />
            </div>
          )}
        </>
      ),
      timer: (
        <>
          <MenuLabel>Countdown</MenuLabel>
          {COUNTDOWNS.map((n) => (
            <MenuItem
              key={n}
              checked={countdownSecs === n}
              onClick={() => {
                setCountdownSecs(n);
                setPopover(null);
              }}
            >
              {n === 0 ? 'Start immediately' : `${n} seconds`}
            </MenuItem>
          ))}
        </>
      ),
      more: (
        <>
          <MenuItem
            icon={<FolderIcon size={15} />}
            onClick={() => {
              setPopover(null);
              window.frameflow.app.openMain({ view: 'library' });
            }}
          >
            Open library
          </MenuItem>
          <MenuItem icon={<UploadIcon size={15} />} onClick={importVideo} disabled={importing}>
            {importing ? 'Importing…' : 'Import video…'}
          </MenuItem>
          <MenuDivider />
          <button
            onClick={() => setHideIcons((v) => !v)}
            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-[4px] hover:bg-slate-800 text-left"
          >
            <MonitorIcon size={15} className="text-slate-400" />
            <span className="flex-1">
              <span className="block text-slate-100">Hide desktop icons</span>
              <span className="block text-[11px] text-slate-500">While recording, for a clean desktop</span>
            </span>
            <Switch on={hideIcons} />
          </button>
          {shortcut && (
            <>
              <MenuDivider />
              <div className="flex items-center justify-between gap-3 px-2.5 py-1.5 text-[11px] text-slate-500">
                <span>{shortcut.registered ? 'Start / stop anywhere' : 'Global shortcut unavailable'}</span>
                {shortcut.registered && <Kbd>Ctrl+Alt+R</Kbd>}
              </div>
            </>
          )}
        </>
      ),
    }[popover.kind];
    const width = { source: 380, mic: 300, camera: 300, timer: 200, more: 250 }[popover.kind];
    overlay = (
      <div
        className="absolute rounded-[7px] border border-black/70 bg-slate-900 p-1 text-[12.5px] text-slate-200 shadow-[0_14px_36px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.05)] hud-rise"
        style={{
          width,
          bottom: BAR_TOP + POPOVER_GAP,
          left: Math.max(12, Math.min(window.innerWidth - width - 12, popover.anchorX - width / 2)),
        }}
      >
        {content}
      </div>
    );
  } else if (error) {
    overlay = (
      <div
        className="absolute left-1/2 -translate-x-1/2 w-[460px] flex items-start gap-2 rounded-[7px] border border-red-500/50 border-l-[3px] border-l-red-500 bg-slate-900 px-3 py-2.5 text-[12px] text-slate-200 shadow-[0_14px_36px_rgba(0,0,0,0.55)] hud-rise"
        style={{ bottom: BAR_TOP + POPOVER_GAP }}
      >
        <span className="flex-1 leading-snug">{error}</span>
        <button onClick={() => setError(null)} className="text-slate-500 hover:text-slate-200 mt-0.5" title="Dismiss">
          <CloseIcon size={13} />
        </button>
      </div>
    );
  }

  const notesPanel =
    showNotes && !overlay && (phase === 'setup' || phase === 'recording' || phase === 'countdown') ? (
      <div
        className="absolute left-1/2 -translate-x-1/2 w-[520px] rounded-[8px] border border-black/70 bg-slate-900/95 text-slate-200 shadow-[0_14px_36px_rgba(0,0,0,0.55)] flex flex-col hud-rise"
        style={{ bottom: BAR_TOP + POPOVER_GAP, maxHeight: 400 }}
      >
        <div className="flex items-center gap-2 h-8 px-3 border-b border-black/50 text-[11px] text-slate-400">
          <NotesIcon size={13} />
          <span className="flex-1">Speaker notes · only you see these, they are never recorded</span>
          <button onClick={() => setNotesSize((v) => Math.max(12, v - 2))} className="px-1.5 hover:text-slate-100" title="Smaller text">
            A−
          </button>
          <button onClick={() => setNotesSize((v) => Math.min(28, v + 2))} className="px-1.5 hover:text-slate-100" title="Larger text">
            A+
          </button>
          <button onClick={() => setShowNotes(false)} className="hover:text-slate-100" title="Hide notes">
            <CloseIcon size={13} />
          </button>
        </div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value.slice(0, 20000))}
          placeholder="Your talking points…"
          spellCheck={phase === 'setup'}
          className="flex-1 min-h-[160px] h-[300px] resize-none bg-transparent px-3.5 py-2.5 outline-none leading-relaxed placeholder:text-slate-600 ff-scroll"
          style={{ fontSize: notesSize }}
        />
      </div>
    ) : null;

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 overflow-hidden"
      onMouseDown={(e) => e.target === e.currentTarget && setPopover(null)}
    >
      {overlay}
      {notesPanel}
      <div className="absolute inset-x-0 bottom-0 flex justify-center pointer-events-none">
        {/* The padding is a small solid margin, so the pointer turns the window
            interactive before it reaches the drag regions. */}
        <div className="pointer-events-auto p-3">
          <div className="rounded-[8px] border border-black/80 bg-slate-900 text-slate-200 shadow-[0_10px_30px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.06)] overflow-hidden">
            <div className="drag h-[26px] flex items-center gap-2 pl-2.5 pr-1 bg-slate-950 border-b border-black/60 text-[11px]">
              <LogoMark size={16} />
              <span className="font-semibold tracking-wide text-slate-300">Frame Studio</span>
              <span className="text-slate-600">/</span>
              {status}
              <span className="flex-1" />
              {phase === 'setup' && (
                <HeaderButton title="More" active={popover?.kind === 'more'} onClick={(e) => togglePopover('more', e)}>
                  <MoreIcon size={14} />
                </HeaderButton>
              )}
              <HeaderButton title="Minimize" onClick={() => window.frameflow.hud.minimize()}>
                <MinusIcon size={14} />
              </HeaderButton>
              {phase === 'setup' && (
                <HeaderButton title="Quit Frame Studio" danger onClick={() => window.frameflow.hud.close()}>
                  <CloseIcon size={14} />
                </HeaderButton>
              )}
            </div>
            <div className="drag h-[62px] flex items-center gap-1 px-2.5">{body}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatTimecode(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

function SourceMenu({ screens, windows, sourceId, area, onPick, onRefresh, onChooseArea, onClearArea, onResizeWindow, resizeNote }) {
  const selected = [...screens, ...windows].find((s) => s.id === sourceId);
  return (
    <div className="max-h-[480px] overflow-y-auto">
      <div className="flex items-center justify-between pr-1">
        <MenuLabel>Displays</MenuLabel>
        <button
          onClick={onRefresh}
          title="Refresh"
          className="p-1 rounded-[4px] text-slate-500 hover:text-slate-200 hover:bg-slate-800"
        >
          <RefreshIcon size={13} />
        </button>
      </div>
      {screens.length === 0 && windows.length === 0 && (
        <p className="px-2.5 py-3 text-slate-500">Looking for displays…</p>
      )}
      <div className="grid grid-cols-2 gap-1.5 px-1 pb-1">
        {screens.map((s) => (
          <button
            key={s.id}
            onClick={() => onPick(s.id)}
            className={`text-left rounded-[5px] p-1 border transition-colors ${
              s.id === sourceId ? 'border-indigo-500 bg-indigo-500/10' : 'border-transparent hover:bg-slate-800'
            }`}
          >
            <div className="aspect-video rounded-[3px] overflow-hidden bg-black">
              {s.thumbnail && <img src={s.thumbnail} alt="" className="w-full h-full object-cover" />}
            </div>
            <div className="mt-1 px-0.5 text-[11.5px] text-slate-300 truncate">{s.name}</div>
          </button>
        ))}
      </div>
      {selected?.kind === 'screen' && (
        <>
          <MenuItem icon={<AreaIcon size={15} />} onClick={onChooseArea}>
            {area ? 'Change area…' : 'Record an area…'}
          </MenuItem>
          {area && (
            <MenuItem icon={<MonitorIcon size={15} />} onClick={onClearArea}>
              Record the whole display
            </MenuItem>
          )}
        </>
      )}
      {selected?.kind === 'window' && (
        <>
          <MenuDivider />
          <MenuLabel>Resize this window</MenuLabel>
          <div className="grid grid-cols-3 gap-1 px-1.5 pb-1">
            {WINDOW_SIZES.map(([w, h]) => (
              <button
                key={`${w}x${h}`}
                disabled={resizeNote?.busy}
                onClick={() => onResizeWindow(w, h)}
                className="h-7 rounded-[4px] border border-slate-700 hover:border-slate-500 hover:bg-slate-800 text-[11.5px] tabular-nums text-slate-200 disabled:opacity-50"
              >
                {w}×{h}
              </button>
            ))}
          </div>
          {resizeNote?.text && (
            <p className={`px-2.5 pb-1 text-[11px] ${resizeNote.error ? 'text-red-400' : 'text-slate-400'}`}>{resizeNote.text}</p>
          )}
        </>
      )}
      {windows.length > 0 && (
        <>
          <MenuDivider />
          <MenuLabel>Windows</MenuLabel>
          {windows.map((w) => (
            <MenuItem
              key={w.id}
              checked={w.id === sourceId}
              icon={w.appIcon ? <img src={w.appIcon} alt="" className="w-4 h-4" /> : <WindowIcon size={15} />}
              onClick={() => onPick(w.id)}
            >
              {w.name}
            </MenuItem>
          ))}
        </>
      )}
    </div>
  );
}

function Separator() {
  return <div className="self-stretch w-px my-2.5 mx-1.5 bg-black/50 shadow-[1px_0_0_rgba(255,255,255,0.05)]" />;
}

function HeaderButton({ children, title, onClick, active, danger }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`no-drag w-6 h-[22px] rounded-[3px] flex items-center justify-center transition-colors ${
        active ? 'bg-slate-700 text-slate-100' : 'text-slate-400'
      } ${danger ? 'hover:bg-red-600 hover:text-white' : 'hover:bg-slate-700 hover:text-slate-100'}`}
    >
      {children}
    </button>
  );
}

// Tool tile: icon over a small caption, in the style of a pro-app tool panel.
function Tile({ children, label, title, onClick, onBlur, active, off, danger, autoFocus }) {
  const tone = danger
    ? 'bg-red-600 text-white'
    : active
      ? 'bg-slate-800 text-indigo-300 shadow-[inset_0_0_0_1px_var(--color-indigo-500)]'
      : off
        ? 'text-slate-500 hover:bg-slate-800 hover:text-slate-300'
        : 'text-slate-200 hover:bg-slate-800';
  return (
    <button
      onClick={onClick}
      onBlur={onBlur}
      autoFocus={autoFocus}
      title={title || label}
      className={`no-drag w-[58px] h-[50px] rounded-[5px] flex flex-col items-center justify-center gap-1 transition-colors ${tone}`}
    >
      {children}
      <span className="text-[10px] leading-none whitespace-nowrap">{label}</span>
    </button>
  );
}

function RecordButton({ children, onClick, disabled, title }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="ff-record-btn no-drag ml-1 rounded-[5px] h-9 min-w-[104px] pl-3 pr-4 text-[13px]"
    >
      {children}
    </button>
  );
}

function SecondaryButton({ children, onClick }) {
  return (
    <button
      onClick={onClick}
      className="no-drag h-8 px-4 rounded-[5px] border border-slate-600 text-[12.5px] text-slate-200 hover:bg-slate-800 hover:border-slate-500 transition-colors"
    >
      {children}
    </button>
  );
}

function Kbd({ children }) {
  return (
    <kbd className="px-1.5 py-0.5 rounded-[3px] border border-slate-700 bg-slate-950 font-sans text-[10.5px] text-slate-300">
      {children}
    </kbd>
  );
}

// Segmented meter, green -> amber -> red like an audio track meter.
function LevelMeter({ level }) {
  const lit = Math.round(Math.min(1, level * 1.4) * 24);
  return (
    <div className="flex gap-[2px] px-2.5 pt-1.5 pb-2">
      {Array.from({ length: 24 }, (_, i) => (
        <span
          key={i}
          className={`h-1.5 flex-1 rounded-[1px] ${
            i >= lit ? 'bg-slate-800' : i >= 21 ? 'bg-red-500' : i >= 16 ? 'bg-amber-400' : 'bg-emerald-500'
          }`}
        />
      ))}
    </div>
  );
}

function MenuLabel({ children }) {
  return (
    <div className="px-2.5 pt-2 pb-1 text-[10px] font-medium uppercase tracking-[0.08em] text-slate-500">
      {children}
    </div>
  );
}

function MenuDivider() {
  return <div className="h-px bg-black/50 my-1 mx-1 shadow-[0_1px_0_rgba(255,255,255,0.04)]" />;
}

// Menu rows highlight solid blue on hover, like desktop pro-app menus.
function MenuItem({ children, icon, checked, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="group w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-[4px] text-left text-slate-200 hover:bg-indigo-600 hover:text-white disabled:opacity-50 disabled:hover:bg-transparent"
    >
      {icon && <span className="w-4 flex justify-center text-slate-400 group-hover:text-white shrink-0">{icon}</span>}
      <span className="flex-1 truncate">{children}</span>
      {checked && <CheckIcon size={14} className="text-indigo-400 group-hover:text-white shrink-0" />}
    </button>
  );
}

function Switch({ on }) {
  return (
    <span className={`w-7 h-4 rounded-full p-0.5 transition-colors ${on ? 'bg-indigo-500' : 'bg-slate-600'}`}>
      <span className={`block w-3 h-3 rounded-full bg-white transition-transform ${on ? 'translate-x-3' : ''}`} />
    </span>
  );
}
