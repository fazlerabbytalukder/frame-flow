# FrameFlow vs Screen Studio — clean-room gap analysis

Researched 2026-10-25 from public sources only: screen.studio (home page,
guide, roadmap, terms of service). No Screen Studio binaries, code or assets
were examined. Every item below is a description of observable product
behaviour; FrameFlow implementations must be original.

Screen Studio's terms don't explicitly forbid reverse engineering, but they
claim rights in "proprietary algorithms" and "trade secrets". Keep this
clean-room: build from behaviour descriptions, never from their app internals.

## Positioning

- **Screen Studio is macOS-only, and Windows is not planned** (stated on their
  site). FrameFlow's Windows focus is the core differentiator; the plan's
  positioning holds.
- Screen Studio pricing: $29/mo monthly, $9/mo billed yearly, all features in
  every plan; one-time licences discontinued. A one-time / local-first licence
  is a credible counter-position.
- FrameFlow already ships things Screen Studio lists as planned or paused:
  **multi-clip projects** (their roadmap: planned), **annotations** (theirs:
  paused).

## Already at parity (FrameFlow has it)

Display/window capture · webcam + mic + system audio · pause/resume · countdown
· crash-safe incremental saving + recovery · click-driven auto-zoom suggestions
+ manual zooms · smoothed cursor overlay · click ripples · trim/split/speed
· crop · captions (manual) · backgrounds (gradients, solid, own image) ·
padding/radius/shadow · saved style themes · 16:9 / 1:1 / 9:16 · MP4 + GIF
export · local-only by default.

## Gaps, ranked

Effort: S ≈ ≤1 day, M ≈ 2–4 days, L ≈ 1–2 weeks. All are local-only and
Windows-feasible with the current stack unless noted.

### Tier 1 — the "feel" gap (highest value)

| # | Feature (Screen Studio behaviour) | FrameFlow today | How to build it | Effort |
|---|---|---|---|---|
| 1 | **Camera follows the cursor while zoomed** ("screen moving" while zoomed in) | Zoom holds a fixed point | `zoom-engine`: while a zoom is active, target = smoothed cursor (source-time via `resolve()`), with a dead-zone so small moves don't pan | M |
| 2 | **Spring-based screen animation** with presets *Focused* (settles fast) / *Smooth* | Fixed smoothstep in/out | Critically damped spring evaluated deterministically by integrating from the zoom start at fixed steps (preview and export must stay identical) | M |
| 3 | **Motion blur** with strength, per-animation toggles (cursor / zoom / pan) | None | Export: accumulate N sub-frame draws at fractional times into the canvas (`globalAlpha` 1/N); preview: off or N=2 | M |
| 4 | **Cursor polish**: hide when idle, loop to start position, animation styles *Smooth/Medium/Rapid/None*, rotate while moving, remove shakes, stop moving at end | Smoothing window only | All are pure functions over the cursor samples in `cursor-track.js` + style flags | M |
| 5 | **Keyboard shortcut overlay** (keycaps) | None | `uiohook` keydown/keyup already available; record **only modifier combos** (Ctrl/Alt/Win + key) for privacy; draw keycaps in `drawFrame` | M |
| 6 | **Detect typing stretches and offer speed-up** ("apply to all typing parts") | None | Keystroke-density segments from the same hook (store timestamps only, not keys) → split clips + suggested speed; raise speed cap above 2× (chain `atempo`) | M |
| 7 | **Export options**: 720p/1080p/4K, 24/30/60 fps, quality level; hardware encoding; copy result to clipboard | Fixed CRF 18, libx264, 30/60 fps | Bundled FFmpeg already has `h264_nvenc`, `h264_qsv`, `h264_amf`, `h264_mf` — probe once and fall back to libx264; quality → CRF/CQ; clipboard via Electron `clipboard` (file drop list) | S–M |

### Tier 2 — content features

| # | Feature | How to build it | Effort |
|---|---|---|---|
| 8 | **Masks**: blur/pixelate a region (hide sensitive data); **highlight** a region and dim the rest | New annotation types drawn in `drawFrame` (pixelate = draw downscaled then upscaled with smoothing off) | M |
| 9 | **Camera layouts per segment** (fullscreen camera, split, overlay, screen only) with animated transitions | Layout events on the timeline like zooms; interpolate PiP rect between layouts | L |
| 10 | **Hide camera during silence**, **smart framing** (camera moves away from the cursor) | FFmpeg `silencedetect` on the mic track at import; PiP corner chosen per segment from cursor position | M |
| 11 | **Audio cleanup**: noise reduction, loudness | FFmpeg `afftdn` (built-in) or `arnndn` (needs a bundled model file) + `loudnorm` in the export audio graph | S |
| 12 | **Click sounds**, **background music** looped to length | Mix extra inputs in the export filter graph (`amix`, `aloop`); ship royalty-free assets only | S–M |
| 13 | **Local transcription** → auto captions, `.srt` export, remove filler words and long pauses, edit-by-transcript | Bundle `whisper.cpp` (CPU, ~75 MB base model as optional download); word timestamps drive captions and cut suggestions | L |
| 14 | **Recording**: area selection, global start/stop shortcut, import an existing video as a project | `globalShortcut`; crop-on-capture for area; import = copy + remux + `createProjectDocument` | M |
| 15 | **Style**: shadow angle/distance/softness, inset, bundled wallpapers, preset export/import as a file | Extend `style` + `composition-engine`; wallpapers must be original or properly licensed | S |
| 16 | **Loupe zoom** (magnifier lens instead of full-frame zoom) | Second zoom type: circular clip region drawn at scale over the unzoomed frame | M |
| 17 | Copy current frame as image · command palette (Ctrl+K) · "reel mode" platform-UI overlay preview | Small UI items | S each |

### Out of scope for now

- **Cloud**: shareable links, timed comments, view counts, team project sharing,
  cloud transcription, AI voiceover. The plan defers cloud until demand is
  validated (§11/§13).
- **Apple-specific**: iPhone/iPad over USB with device mockup, ScreenCaptureKit,
  macOS wallpapers, hide-dock-icon.
- **Real-time AI upscaler ("Clarity")**, camera background removal, face
  tracking: possible later with ONNX models, but large effort and model
  licensing to check.

## Implementation status (2026-10-25)

| # | Feature | Status |
|---|---|---|
| 1 | Camera follows cursor while zoomed (dead zone) | Done |
| 2 | Spring screen animation: Focused / Smooth (+ Classic for old projects) | Done |
| 3 | Motion blur (cursor / zoom / pan, strength) | Done |
| 4 | Cursor polish: styles, idle hide, loop, stop at end, tilt, remove shakes | Done |
| 5 | Keyboard shortcut keycaps (Ctrl/Alt/Win combos only; typing never stored) | Done |
| 6 | Typing detection + "speed up all typing" (speeds up to 4×, chained atempo) | Done |
| 7 | Export: 720p/1080p/4K, 24/30/60 fps, quality, GPU encoding, copy to clipboard | Done |
| 8 | Masks: pixelate blur, spotlight | Done |
| 9 | Camera layouts (camera / split / screen only) with animated transitions | Done |
| 10 | Hide camera during silence; bubble moves out of the cursor's way | Done |
| 11 | Noise reduction + loudness normalization | Done |
| 12 | Click sounds (synthesized) + looping background music | Done |
| 13 | Captions as .srt with the export | Done |
| 13 | Local transcription (auto captions, filler/pause removal, edit by text) | Deferred (2026-10-25): manual captions + .srt cover it for now; revisit with a bundled or on-demand whisper.cpp model |
| 14 | Area recording, global Ctrl+Alt+R start/stop, import existing video | Done |
| 15 | Shadow angle/distance/softness, inset bezel, more gradients, theme files | Done |
| 16 | Loupe zoom (magnifier lens; respects masks) | Done |
| 17 | Copy frame as image, Ctrl+K command menu, reel-mode safe zones | Done |

Known limitations: noise reduction, loudness and click sounds are applied on
export (not in the live preview); smart framing judges the cursor on the
unzoomed frame; area recording records the full display and crops (the crop
can be widened later).

## Suggested order

1 → 2 → 4 → 3 (camera and cursor feel, all in the shared engine, covered by
the existing unit and visual tests), then 7 (cheap, visible), then 5 + 6 (both
reuse the global hook), then Tier 2 by customer demand.

Each item lands with tests in `tests/unit` (pure engine math) and
`tests/electron/visual.test.js` (pixel checks), and preview/export must keep
sharing `src/engine/*`.
