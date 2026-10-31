# FrameFlow: Screen Studio-Inspired Windows Desktop App

> **Project goal:** Build a commercial Windows desktop application that records screens and turns raw recordings into polished product demos, tutorials, onboarding videos, and social-media clips.
>
> **Approach:** Study publicly observable product behavior, document the requirements, and implement an independent product. Do not copy proprietary source code, branding, or distinctive assets.

## 1. Product Vision

Use **FrameFlow** as a temporary codename only; check name and trademark availability before commercial use.

The application should let users record once and produce a polished video without learning a complex traditional video editor.

### Core capabilities

- Screen or application-window recording
- Microphone and supported system-audio capture
- Webcam overlay and synchronization
- Cursor tracking, smoothing, and click indicators
- Suggested and manually editable zoom effects
- Multi-clip timeline editing
- Backgrounds, shadows, rounded corners, and framing
- Portrait, square, and landscape layouts
- Captions, annotations, and highlights
- Local MP4 export, with GIF or other formats where practical
- Project library, autosave, recovery, and optional cloud sharing

## 2. Reverse-Engineering Research Plan

Treat reverse engineering as **black-box product analysis**: observe public interfaces and behavior, record test cases, form hypotheses, and implement your own version.

Do not assume access to Screen Studio's internal code or algorithms. Avoid bypassing licensing/access controls or copying proprietary code and assets.

### Research checklist

- [ ] **Recording workflow:** source selection, countdown, pause/resume, microphone selection, and recording completion
- [ ] **Cursor behavior:** smoothing, click indicators, cursor visibility, and differences between raw and exported motion
- [ ] **Automatic zoom:** timing, focus position, scale, easing, and transition duration
- [ ] **Editor interactions:** timeline behavior, trimming, zoom adjustments, keyboard shortcuts, undo/redo, and inspector panels
- [ ] **Visual styling:** backgrounds, shadows, rounded corners, webcam placement, cropping, and aspect ratios
- [ ] **Export behavior:** dimensions, codecs, quality settings, progress, synchronization, and failure handling
- [ ] **Project persistence:** which edits remain editable after closing and reopening a project

For each test, record:
1. Input and setup
2. Observable behavior
3. Expected output
4. Your implementation decision
5. Open questions and risks

Use your own test recordings and files wherever possible.

## 3. Recommended Technology Stack

| Layer | Suggested technology | Responsibility |
|---|---|---|
| Desktop shell | Electron | Windows app, windows, menus, permissions |
| UI | React + JavaScript/JSX | Recorder, editor, timeline, settings |
| Styling | Tailwind CSS | Consistent interface |
| UI state | Zustand or Redux Toolkit | Playback state, selected clip, controls |
| Capture | Electron `desktopCapturer` + supported media APIs | Screen/window and supported audio capture |
| Media processing | FFmpeg | Encoding, trimming, compositing, audio processing |
| Preview | HTML Canvas initially; WebGL when needed | Preview effects, cursor, zoom, composition |
| Local metadata | SQLite | Project metadata and preferences |
| Project format | Versioned JSON + local media | Non-destructive editing |
| Optional backend | Node.js API | Accounts, subscriptions, cloud sync, sharing |
| Payments | Hosted payment provider | Checkout and billing |

### Documentation

- Electron screen capture: https://www.electronjs.org/docs/latest/api/desktop-capturer
- Electron security: https://www.electronjs.org/docs/latest/tutorial/security
- FFmpeg documentation: https://www.ffmpeg.org/documentation.html
- FFmpeg filters: https://www.ffmpeg.org/ffmpeg-filters.html
- FFmpeg legal information: https://ffmpeg.org/legal.html

### Architecture principles

Keep these responsibilities separate:

1. **Capture service:** records media and event timestamps.
2. **Project engine:** stores editable instructions rather than baking every effect into the source recording.
3. **Preview engine:** displays the edit quickly.
4. **Render engine:** turns the same project instructions into the final video.
5. **Desktop shell:** manages files, permissions, menus, and secure IPC.
6. **Optional cloud service:** accounts, billing, sync, and sharing.

The app should support recording and local editing without an internet connection.

### Security requirements

- Enable Electron context isolation.
- Keep Node.js access out of the renderer.
- Use a restrictive preload API.
- Validate all IPC messages and arguments.
- Restrict filesystem access to intended paths.
- Treat imported project files and media as untrusted input.
- Keep dependencies updated and audit them before releases.

## 4. Suggested Project Structure

```text
frameflow/
├── electron/
│   ├── main.js
│   ├── preload.js
│   ├── ipc/
│   │   ├── recording.js
│   │   ├── projects.js
│   │   └── export.js
│   └── services/
│       ├── capture-service.js
│       ├── cursor-service.js
│       ├── media-service.js
│       ├── render-service.js
│       └── recovery-service.js
├── src/
│   ├── app/
│   ├── components/
│   ├── features/
│   │   ├── recorder/
│   │   ├── editor/
│   │   ├── timeline/
│   │   ├── zoom/
│   │   ├── captions/
│   │   └── export/
│   ├── engine/
│   │   ├── project-schema.js
│   │   ├── timeline-engine.js
│   │   ├── zoom-engine.js
│   │   ├── composition-engine.js
│   │   └── export-planner.js
│   └── stores/
├── tests/
│   ├── unit/
│   ├── integration/
│   └── fixtures/
├── package.json
└── README.md
```

This is a proposed structure, not a requirement to create every file immediately. Add modules when their features are needed. Use JavaScript and JSX, not TypeScript, for the frontend.

## 5. Project File Format

Editing should be **non-destructive**. Preserve original media and store edit instructions separately so users can adjust zooms, backgrounds, and framing later.

Illustrative project:

```json
{
  "schemaVersion": 1,
  "project": {
    "name": "Product Demo",
    "width": 1920,
    "height": 1080,
    "frameRate": 30
  },
  "assets": [
    {
      "id": "screen-1",
      "type": "screen-recording",
      "path": "media/screen.mp4"
    }
  ],
  "clips": [
    {
      "id": "clip-1",
      "assetId": "screen-1",
      "start": 0,
      "duration": 25
    }
  ],
  "zoomEvents": [
    {
      "id": "zoom-1",
      "time": 4.2,
      "duration": 1.1,
      "x": 0.65,
      "y": 0.45,
      "scale": 1.8
    }
  ],
  "style": {
    "background": "gradient",
    "cornerRadius": 18,
    "shadow": true
  }
}
```

Production projects will also need validation, relative asset paths, audio tracks, transitions, undo history, and schema migrations. Use normalized coordinates for cursor and zoom positions, and timestamps tied to a consistent media timeline.

## 6. Feature Roadmap

### A. Recording engine

- [ ] Select a display or application window
- [ ] Select microphone and show an audio-level meter
- [ ] Capture supported system audio
- [ ] Start, stop, pause, and resume recording
- [ ] Show countdown and recording status
- [ ] Capture webcam and synchronize it with screen footage
- [ ] Recover after an interrupted recording where possible

### B. Cursor and automatic zoom engine

- [ ] Record cursor coordinates and timestamps
- [ ] Smooth cursor movement during playback
- [ ] Detect clicks and optional interaction points
- [ ] Suggest zoom regions
- [ ] Animate zoom in/out with configurable easing
- [ ] Let users add, move, resize, and remove zooms
- [ ] Add click highlights and cursor presets

### C. Multi-clip timeline

- [ ] Trim, split, reorder, and delete clips
- [ ] Move clips along a timeline
- [ ] Control clip speed and transitions
- [ ] Add audio tracks and adjust volume
- [ ] Implement undo and redo
- [ ] Add keyboard shortcuts and snapping
- [ ] Save edits without modifying source media

### D. Visual composition

- [ ] Solid, gradient, and image backgrounds
- [ ] Rounded corners, shadows, and framing
- [ ] Portrait, square, and landscape layouts
- [ ] Webcam overlays and picture-in-picture
- [ ] Crop and position controls
- [ ] Text annotations, arrows, and highlights
- [ ] Reusable themes and templates

### E. Export engine

- [ ] MP4 export with suitable codecs
- [ ] Resolution and frame-rate controls
- [ ] Audio/video synchronization
- [ ] GIF and other formats where practical
- [ ] Export progress, cancellation, and retry
- [ ] Temporary-file cleanup and disk-space checks
- [ ] Consistent preview and exported output

### F. Commercial-grade product

- [ ] Project library and autosave
- [ ] Crash recovery and project migration
- [ ] Signed Windows installer and update strategy
- [ ] Diagnostics and opt-in crash reporting
- [ ] Licensing and subscription management if needed
- [ ] Optional cloud storage and share links
- [ ] Onboarding, support, and documentation

### Defer until the core app works

- AI-generated narration
- Collaborative cloud editing
- Browser-based rendering
- Complex keyframe animation
- Team workspaces

## 7. Automatic Zoom Engine

Treat automatic zoom as an editable suggestion system rather than an effect users cannot control.

### Processing pipeline

1. Collect cursor, click, and timestamp events.
2. Filter noisy events and group nearby clicks.
3. Generate zoom suggestions with target position, scale, and timing.
4. Interpolate camera position and scale using smooth easing.
5. Let users accept, adjust, remove, or regenerate suggestions.

A common easing function is smoothstep:

\[
s(t)=3t^2-2t^3,\quad 0\leq t\leq1
\]

Interpolate scale between `z0` and `z1`:

\[
z(t)=z_0+(z_1-z_0)s(t)
\]

Also interpolate position and constrain the visible frame to the source bounds. Start with cursor/click heuristics; consider optional computer vision later. A click does not always mean the user wants a zoom.

### Cursor tracking caveat

Electron capture does not automatically provide a complete, synchronized global cursor-event history. Windows may require a separate, narrowly scoped native cursor-capture component. Design it with user consent, limited collection, and clear controls.

## 8. Preview and Rendering

The preview and final export should use the same underlying edit instructions.

- **Preview:** Canvas or WebGL renders the current composition at interactive speed.
- **Timeline engine:** calculates which clips, zooms, overlays, and effects apply at each timestamp.
- **Export planner:** converts the project into a deterministic sequence of rendering operations.
- **FFmpeg worker:** processes video, audio, compositing, and encoding outside the React UI thread.
- **Validation:** checks output duration, dimensions, frame rate, audio, and file integrity.

FFmpeg is a media-processing engine, not a replacement for the project model, interactive timeline, or preview renderer.

## 9. Milestones and Schedule

Planning estimate for one developer working part-time: **6–9 months for a serious first commercial beta**, with additional time potentially needed for reliability, performance, and support.

| Timing | Milestone | Exit criterion |
|---|---|---|
| Weeks 1–2 | Technical proof of concept | Capture a screen, record a short clip, and export a playable video |
| Weeks 3–6 | Recorder and persistence | Recordings save and reopen reliably; basic recovery works |
| Weeks 7–10 | Zoom and cursor engine | Users can create and adjust smooth zooms |
| Weeks 11–16 | Editor and rendering | Edit a basic tutorial and export it without another editor |
| Weeks 17–22 | Advanced features and quality | Webcam composition, captions, aspect ratios, undo/redo, and export presets work |
| Weeks 23–36 | Commercial beta | External users can install, record, edit, export, and report issues |

These phases may overlap. Full multitrack editing, transcription, and cloud collaboration can be follow-on milestones.

## 10. Testing Strategy

| Test category | Verify |
|---|---|
| Unit tests | Zoom math, easing curves, timeline calculations, project schema |
| Capture integration | Screen/window selection, permissions, start/stop behavior |
| Media integration | FFmpeg execution, codecs, audio synchronization |
| Visual regression | Zoom framing, crop, rounded corners, overlays |
| Performance | CPU/RAM use, dropped frames, preview responsiveness |
| Recovery | Interrupted recordings/exports, crashes, disk-full errors |
| Compatibility | Supported Windows versions, display scaling, multiple monitors |
| Security | IPC validation, local file access, imported project handling |
| Release testing | Install, update, uninstall, clean-machine launch |

### Minimum beta acceptance checklist

- [ ] Record a 10-minute screen session without an unrecoverable failure.
- [ ] Capture microphone and supported system audio in the same session.
- [ ] Reopen a saved project and preserve all edits.
- [ ] Change zoom points and get consistent preview/export results.
- [ ] Export landscape, square, and portrait videos without unexpected cropping.
- [ ] Cancel an export and safely start another.
- [ ] Recover a project after a crash where possible.
- [ ] Run recording and local editing without internet access.
- [ ] Confirm recordings are not uploaded without explicit consent.

Test on lower-memory computers as well as the development machine.

## 11. Commercial Business Model

Start with a **local-first paid desktop product**, then add optional cloud services only if customers request them.

### Possible models

- **One-time license:** a defined feature set and update policy for customers who prefer non-recurring payments.
- **Subscription:** ongoing updates, premium templates, advanced features, and optional cloud services.
- **Team plan:** shared templates, centralized billing, team projects, and cloud sharing for agencies and product teams.

Validate demand and willingness to pay before setting prices or building cloud infrastructure.

### Initial target customers

- **SaaS founders and developers:** product demos, feature announcements, bug reports, and onboarding.
- **Educators and tutorial creators:** software lessons and course videos.
- **Agencies and product teams:** client walkthroughs, release demos, and support explanations.

Potential positioning: *A fast, lightweight Windows tool for polished SaaS product demos—without learning a professional video editor.*

## 12. Major Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Capture and system audio differ by hardware | Test real Windows configurations early; clearly report unsupported modes |
| Export is slow or memory-intensive | Use background workers, bounded processing, and hardware encoding where supported |
| Preview differs from export | Share timeline calculations and effect definitions |
| Users lose work | Autosave, atomic writes, recovery snapshots, and source-media preservation |
| Media licensing issues | Audit FFmpeg build configuration, codecs, dependencies, fonts, and assets |
| Security vulnerabilities | Harden Electron, validate IPC, restrict file access, update dependencies |
| Low willingness to pay | Interview users and validate payment interest with a working prototype |
| Competitors add similar features | Differentiate through workflow, reliability, performance, templates, and a focused niche |

FFmpeg obligations depend on the build configuration and included components. Review https://ffmpeg.org/legal.html and seek qualified advice before distributing a commercial installer. Review privacy and data-protection requirements before adding cloud storage, analytics, or uploads.

## 13. Optional Cloud Architecture

Add a backend only after the desktop app demonstrates demand.

- **Windows app:** capture, edit, and render locally.
- **Node.js API:** authentication, subscriptions, and project metadata.
- **PostgreSQL:** user and project metadata.
- **S3-compatible object storage:** opt-in videos and assets.
- **Hosted billing provider:** checkout and subscription management.

Check provider availability, supported business country, and payout requirements for Bangladesh before committing to a payment provider.

Never upload recordings by default. Product demos may contain credentials, customer data, private dashboards, or other sensitive information.

## 14. First 30 Days

### Week 1 — Research and prove capture

- [ ] Complete the research checklist.
- [ ] Set up Electron with React and JavaScript.
- [ ] Capture a selected screen or window.
- [ ] Record a short clip and verify the output.

### Week 2 — Build recording workflow

- [ ] Add microphone selection and audio checks.
- [ ] Build start/stop controls and recording status.
- [ ] Save recordings in a user-selected location.
- [ ] Handle errors and permissions.

### Week 3 — Create editor foundation

- [ ] Design the main editor interface.
- [ ] Add video preview and playback controls.
- [ ] Create a versioned project JSON format.
- [ ] Implement basic trimming and save/reopen.

### Week 4 — Prove the core differentiator

- [ ] Capture or collect cursor events.
- [ ] Implement one manually adjustable zoom effect.
- [ ] Render a test video with the effect.
- [ ] Ask a few target users to try the workflow.

## 15. Recommended First Technical Milestone

Do not begin by trying to match every Screen Studio feature. First prove you can reliably:

1. Capture a screen and audio.
2. Save the source recording.
3. Create and persist a project.
4. Add an editable zoom effect.
5. Preview the result.
6. Export a polished video.

Once this works, expand into multi-clip editing, webcam layouts, captions, templates, and commercial distribution.

## Definition of Success

The first meaningful milestone is a complete workflow that takes a raw screen recording and produces a polished video with an editable zoom effect. That proves the foundation for the broader product.
