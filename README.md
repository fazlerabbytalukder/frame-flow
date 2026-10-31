# Frame Studio

A Windows desktop screen studio: record your screen, then polish the raw capture into a
shareable demo — animated zooms, styled backgrounds, rounded corners and shadows — and
export a ready-to-post MP4. Built with Electron, React (JavaScript/JSX), Tailwind CSS,
Zustand, and FFmpeg. See `frameflow_screen_studio_alternative_plan.md` for the full
product plan.

## Status

First technical milestone complete and verified end-to-end:

1. **Record** a screen or application window with microphone and system (loopback) audio,
   with source thumbnails, mic level meter, and a 3-2-1 countdown.
2. **Cursor tracking** — global cursor position is sampled at ~60 Hz during recording and
   stored normalized alongside the media.
3. **Project persistence** — every recording becomes a versioned JSON project
   (non-destructive; source media is never modified) under `Documents/Frame Studio/projects/`.
4. **Editor** — canvas preview with background/padding/corner-radius/shadow styling, a
   timeline with a draggable playhead, and **editable zoom events**: add at playhead
   (focus defaults to the recorded cursor position), drag to move/resize on the timeline,
   click the preview to retarget, tune scale/transition in the inspector, or generate
   suggestions from cursor dwell analysis (✨ Suggest).
5. **Export** — deterministic frame-by-frame render through the *same* composition engine
   as the preview, piped to FFmpeg as raw frames and encoded to H.264 MP4 (30/60 fps,
   resolutions derived from the project aspect) or **GIF** (two-pass palette, 15 fps).
   The audio track is rebuilt from the clip sequence (trim + concat) so edits stay in
   sync. Progress + cancel supported.

Second milestone ("Editor and rendering", plan §9 weeks 11–16) complete:

6. **Multi-clip timeline** — split at the playhead (✂ button or `S`), trim clips by
   dragging their edges, delete and reorder clips; clips ripple automatically and all
   edits are windows into the untouched source media. Two-lane timeline with a time ruler.
7. **Undo/redo** — full history for every edit (`Ctrl+Z` / `Ctrl+Y`), with slider and
   drag gestures grouped into single undo steps.
8. **Aspect presets** — 16:9, 1:1 (square), 9:16 (portrait) canvas switching, reflected
   in preview and export.

Third milestone ("Advanced features", plan §9 weeks 17–22, partial) complete:

9. **Webcam recording + picture-in-picture** — optional webcam capture alongside the
   screen (second synchronized recorder, saved as `media/webcam.webm`), composited as a
   circle or rounded overlay with corner position and size controls, in preview and
   export alike. Overlay stays fixed and is unaffected by zooms.
10. **Captions** — timed text captions with their own timeline lane (drag to move,
    edge-drag to resize), a textarea editor in the inspector, and styled subtitle
    rendering (word-wrapped pill) in preview and export.
11. **Master volume** — a 0–150% volume slider applied live in the preview and via an
    FFmpeg `volume` filter on export.

Fourth milestone ("Commercial beta" groundwork, plan §9 weeks 23–36, partial) complete:

12. **Crash-safe recording & recovery** — recording chunks stream to disk every second
    (`Documents/Frame Studio/pending/…`) instead of living in memory, with cursor snapshots
    flushed every 5 s. A clean stop finalizes the pending folder into a project; after a
    crash, the library shows an "Interrupted recording found" banner with Recover /
    Discard. FFmpeg tolerates the truncated WebM stream.
13. **Library management** — rename (inline), delete (to the Recycle Bin, with confirm),
    and open-folder actions on every project card.
14. **Windows installer** — `npm run dist` builds an NSIS setup via electron-builder
    (`release/Frame Studio Setup <version>.exe`), with FFmpeg unpacked from asar so it can
    execute. Unsigned for now; code signing is a release-time task.
15. **Local diagnostics** — main-process errors and renderer crashes are appended to
    `Documents/Frame Studio/logs/frame-studio.log`. Nothing is ever uploaded.

Fifth milestone (remaining roadmap features) complete:

16. **Pause/resume recording** — both recorders pause together, and cursor/click
    timestamps exclude paused periods so they stay aligned with the media.
17. **Click detection** — a global mouse hook (uiohook-napi, N-API) runs only while a
    recording is active; clicks are stored in `cursor.json`, drive click-cluster zoom
    suggestions (replacing the dwell heuristic when present), and render as
    **click-highlight ripples** in preview and export.
18. **Smoothed cursor overlay** — recordings request `cursor: 'never'` at capture; when
    the platform honors it, the editor re-renders a vector cursor from the recorded
    track with triangular-window smoothing, zoom-aware scaling, and a size control.
19. **Clip speed** — 0.5×–2× per clip, applied to preview playback rate, the export frame
    mapping, and the audio graph (`atempo`), with speed-aware timeline math throughout.
20. **Fade clip transitions** — fade-through-background at clip boundaries, identical in
    preview and export.
21. **Timeline snapping** — drags and trims snap to clip boundaries, other blocks, the
    playhead, and whole seconds.
22. **Image backgrounds** — pick any image; it's copied into the project folder so
    projects stay portable.
23. **Crop controls** — trim the source edges (per-side sliders); zoom, cursor and
    annotations all respect the crop.
24. **Annotations** — text labels, arrows, and highlight boxes with their own timeline
    lane, color presets, and click/drag placement on the preview; they stick to the
    content under zooms.
25. **Reusable themes** — save the current frame style under a name and apply it to any
    project (stored in `Documents/Frame Studio/themes.json`).
26. **Disk-space check** — exports refuse to start with under 500 MB free.

Screen Studio parity pass (clean-room, from `docs/screen-studio-gap-analysis.md`):

27. **Camera motion** — zooms can follow the cursor (dead zone), spring animation
    (Focused / Smooth; Classic keeps older projects unchanged), motion blur on cursor,
    zoom and pan, and a **loupe** zoom type (magnifier lens).
28. **Cursor polish** — movement styles, hide when idle, loop to start, stop at end, tilt,
    remove shakes; on-screen **shortcut keycaps** (Ctrl/Alt/Win combos only — typed text
    is never recorded) and **typing detection** with one-click speed-up (up to 4×).
29. **Masks** — pixelate-blur regions to hide data and spotlight regions; both survive
    zooms and loupes.
30. **Camera layouts** — camera / split / screen-only segments with animated transitions;
    the bubble can dodge the cursor and hide during silences.
31. **Audio** — noise reduction, loudness normalization, synthesized click sounds and
    looping background music (all on export).
32. **Export** — 720p / 1080p / 4K, 24/30/60 fps, quality presets, GPU encoding
    (NVENC / Quick Sync / AMF with x264 fallback), copy file to clipboard, `.srt` captions.
33. **Recording & editing extras** — record an area, global `Ctrl+Alt+R` start/stop,
    import existing videos, shadow/inset controls, theme files, copy frame as image,
    `Ctrl+K` command menu, reel-mode safe zones.

Studio features (clean-room, inspired by Screen Studio's feature list):

34. **Transcript editing** — local speech recognition (Whisper base, word timings, via
    transformers.js + onnxruntime-node; the model ships in `assets/models/whisper`). Cut
    words from the text to cut the video; remove filler words and shorten long pauses in
    one pass. Timeline items ripple with the edit.
35. **Captions from speech** — generated from the transcript, kept in sync with edits;
    five looks (pill, bold, outline, minimal, highlight) and animations (fade, pop, word by
    word, karaoke).
36. **Voice modes** — Standard / Noise reduction / Podcast (rumble cut, de-ess, compression,
    presence, limiter) on export.
37. **Camera** — colour looks with strength, halo-free sharpening, face tracking (head found
    in the person mask, stored as `project.faceTrack`).
38. **Smart framing** — zooms pan (or zoom slightly further when pinned to an edge) so the
    camera bubble never covers the cursor.
39. **Enhance** — edge-limited sharpening of upscaled (zoomed) video; dithering of blurred
    backgrounds against banding. **Device frames** — browser, laptop, tablet, phone.
40. **Recording utilities** — speaker notes in the recorder bar (never captured), resize the
    recorded window to an exact size, hide desktop icons while recording.
41. **Sharing** — private links on the local network: Frame Studio hosts the export, viewers comment at exact
    seconds, optional passcode, view counts. Nothing is uploaded to the internet.

## Development

```powershell
npm install
npm run dev     # Vite dev server + Electron with hot reload
npm start       # production build + Electron
npm run dist    # build the Windows installer into release/
npm test        # unit tests (node:test) + Electron integration suite
npm run test:packaged   # smoke-test the built app in release/win-unpacked
```

Tests (plan §10): `tests/unit/` covers zoom, timeline, cursor and composition math
in plain Node; `tests/electron/` runs headless in Electron against a temporary
Documents folder — storage/schema, persistence, recording IPC, crash recovery,
FFmpeg export (A/V sync, aspect presets, GIF, cancel, disk-full), pixel-level
visual regression of the compositor, security/IPC validation, and perf budgets.
`npm run test:electron -- --only=export --keep` narrows a run and keeps its data.

> Note: the npm scripts clear `ELECTRON_RUN_AS_NODE`, which IDE terminals (VS Code) set
> and which otherwise breaks Electron startup.

## Architecture

```
electron/               main process (CommonJS)
  main.js               window, security, frameflow-media:// protocol, display-media handler
  preload.js            the only renderer<->main bridge (contextBridge)
  ipc/                  validated IPC handlers: recording, projects, export
  services/             capture sources, cursor sampler, FFmpeg wrapper, storage (path-rooted)
src/                    renderer (React, ESM)
  engine/               pure logic shared by preview AND export:
    zoom-engine.js        camera math, smoothstep easing, viewport clamping
    composition-engine.js canvas compositor (background, shadow, rounded clip, zoom window)
    cursor-track.js       cursor interpolation + dwell-based zoom suggestions
    export-planner.js     frame-accurate seek -> composite -> stream to FFmpeg
  features/             recorder, library, editor, timeline, export views
  stores/               Zustand stores (app navigation, editor + autosave)
```

Key design decisions (from the plan):

- **Non-destructive editing** — projects store instructions (zoom events, style), never
  baked effects. The raw MediaRecorder output is kept untouched next to a remuxed,
  seekable copy.
- **Preview = export** — both call the same `drawFrame` / `cameraAt`, so what you see is
  what you render.
- **Hardened Electron** — context isolation on, no Node in the renderer, narrow preload
  API, every IPC argument validated, all file paths resolved against and locked to the
  `Documents/Frame Studio` root, media served over a validated custom protocol.

## Data layout

```
Documents/Frame Studio/projects/<id>/
  project.json          versioned project document (schemaVersion 1)
  media/screen-raw.webm untouched recorder output
  media/screen.webm     remuxed (seekable) working copy
  media/webcam.webm     synchronized webcam track (when recorded)
  media/cursor.json     normalized cursor samples
  exports/              rendered MP4s
```

## Releasing

1. `npm test`: all unit and Electron suites must pass.
2. `npm run dist`: builds `dist/` and `release/Frame-Studio-Setup-<version>.exe`.
   If electron-builder fails with EPERM renaming `win-unpacked.tmp` (Defender or
   an editor holding the folder), build elsewhere with
   `npx electron-builder --win --config.directories.output=<other folder>`.
3. `npm run test:packaged [-- <win-unpacked folder>]`: loads FFmpeg, uiohook,
   sharp, onnxruntime + Whisper and the renderer (CSP, sandboxed preload,
   MediaPipe WASM) from inside `app.asar`, in hidden windows. Run it once from a
   deeply nested copy as well, to catch paths over Windows' 260-character limit.
4. Manual pass on a clean machine: install, record, edit, export, uninstall.

Production hardening in place: a single instance, the Chromium sandbox on for
every window, no navigation or webviews, no menu or DevTools in installed
builds, camera and mic permissions only for the app's own windows, a strict CSP
in the built renderer (`scripts/csp.cjs`, no remote origins, no JS eval), and a
local log capped at 2 MB with one rollover.

The installer is **not code-signed** yet, so Windows SmartScreen will warn on
first run. To sign it, set `CSC_LINK` (a .pfx path or base64) and
`CSC_KEY_PASSWORD` before `npm run dist`; electron-builder signs the app,
FFmpeg, the uninstaller and the installer.

## Next milestones (per plan)

All §6 roadmap features that can be built without external infrastructure are done.
What remains is release work and deliberately deferred scope:

- Code signing certificate (see Releasing); auto-update would need a network feed, and the app is offline by design
- Manual §10 passes the suite cannot automate: real capture hardware, multi-monitor/DPI, 10-minute soak, clean-machine install/uninstall
- Licensing/payments and the optional cloud layer (§11/§13) — only after validating demand
- Deferred by plan §6: AI narration, collaborative editing, keyframe animation, teams
