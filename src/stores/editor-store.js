import { create } from 'zustand';
import * as timeline from '../engine/timeline-engine.js';
import { withZoomStyle } from '../engine/zoom-engine.js';
import { cutSourceRanges, rebuildAutoCaptions } from '../engine/transcript.js';

// Editor state for one open project. The project document is the single source
// of truth; every mutation goes through updateProject, which records an undo
// snapshot and schedules an autosave of the full document.

let saveTimer = null;
const MAX_HISTORY = 100;

function scheduleAutosave(get) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const { project } = get();
    if (!project) return;
    try {
      await window.frameflow.projects.save(project);
      get().setSavedState('saved');
    } catch (err) {
      console.error('Autosave failed', err);
      get().setSavedState('error');
    }
  }, 600);
}

const SELECTION_KEYS = [
  'selectedZoomId',
  'selectedClipId',
  'selectedCaptionId',
  'selectedAnnotationId',
  'selectedLayoutId',
  // A cut between clips, named by the clip it leads into.
  'selectedTransitionId',
];

function exclusiveSelection(state, key, id) {
  const patch = {};
  for (const k of SELECTION_KEYS) {
    patch[k] = k === key ? id : id ? null : state[k];
  }
  return patch;
}

export const useEditorStore = create((set, get) => ({
  project: null,
  cursorTrack: null,
  currentTime: 0, // timeline time, not source time
  playing: false,
  selectedZoomId: null,
  selectedClipId: null,
  selectedCaptionId: null,
  selectedAnnotationId: null,
  selectedLayoutId: null,
  selectedTransitionId: null,
  savedState: 'saved', // saved | saving | error
  undoStack: [],
  redoStack: [],
  gestureBase: null, // project before the transient gesture in progress

  setProject: (project, cursorTrack) =>
    set({
      project,
      cursorTrack,
      currentTime: 0,
      playing: false,
      selectedZoomId: null,
      selectedClipId: null,
      selectedCaptionId: null,
      selectedAnnotationId: null,
      selectedLayoutId: null,
      selectedTransitionId: null,
      savedState: 'saved',
      undoStack: [],
      redoStack: [],
      gestureBase: null,
    }),

  setCurrentTime: (t) => set({ currentTime: t }),
  setPlaying: (playing) => set({ playing }),
  // Selecting one kind of object deselects the others.
  selectZoom: (id) => set((s) => exclusiveSelection(s, 'selectedZoomId', id)),
  selectClip: (id) => set((s) => exclusiveSelection(s, 'selectedClipId', id)),
  selectCaption: (id) => set((s) => exclusiveSelection(s, 'selectedCaptionId', id)),
  selectAnnotation: (id) => set((s) => exclusiveSelection(s, 'selectedAnnotationId', id)),
  selectLayout: (id) => set((s) => exclusiveSelection(s, 'selectedLayoutId', id)),
  selectTransition: (id) => set((s) => exclusiveSelection(s, 'selectedTransitionId', id)),
  setSavedState: (savedState) => set({ savedState }),

  // mutator receives a deep copy and returns it (or mutates in place).
  // `transient: true` marks the steps of a continuous gesture (slider or
  // timeline drag); the gesture's final non-transient write records one undo
  // step back to the state from before the gesture began.
  updateProject: (mutator, { transient = false } = {}) => {
    const { project, undoStack, gestureBase } = get();
    if (!project) return;
    const next = mutator(structuredClone(project)) || project;
    if (transient) {
      set({ project: next, savedState: 'saving', gestureBase: gestureBase || project });
    } else {
      set({
        project: next,
        savedState: 'saving',
        undoStack: [...undoStack.slice(-MAX_HISTORY + 1), gestureBase || project],
        redoStack: [],
        gestureBase: null,
      });
    }
    scheduleAutosave(get);
  },

  undo: () => {
    const { undoStack, redoStack, project } = get();
    if (undoStack.length === 0 || !project) return;
    const prev = undoStack[undoStack.length - 1];
    set({
      project: prev,
      undoStack: undoStack.slice(0, -1),
      redoStack: [...redoStack, project],
      savedState: 'saving',
      gestureBase: null,
    });
    scheduleAutosave(get);
  },

  redo: () => {
    const { undoStack, redoStack, project } = get();
    if (redoStack.length === 0 || !project) return;
    const next = redoStack[redoStack.length - 1];
    set({
      project: next,
      redoStack: redoStack.slice(0, -1),
      undoStack: [...undoStack, project],
      savedState: 'saving',
      gestureBase: null,
    });
    scheduleAutosave(get);
  },

  // --- zoom events ---

  addZoomEvent: (zoom) => {
    get().updateProject((p) => {
      p.zoomEvents.push(zoom);
      p.zoomEvents.sort((a, b) => a.time - b.time);
      return p;
    });
    set({ selectedZoomId: zoom.id, selectedClipId: null });
  },

  // Switches the project's zoom style and converts every zoom to it in one
  // undo step.
  setZoomStyle: (zoomStyle) => {
    get().updateProject((p) => {
      p.style.zoomStyle = zoomStyle;
      p.zoomEvents = withZoomStyle(p.zoomEvents, zoomStyle);
      return p;
    });
  },

  // Any hand edit turns an auto zoom into a manual one, so re-running auto
  // zoom never discards the user's adjustments.
  updateZoomEvent: (id, patch, opts) => {
    get().updateProject((p) => {
      const z = p.zoomEvents.find((e) => e.id === id);
      if (z) Object.assign(z, patch, { auto: false });
      return p;
    }, opts);
  },

  removeZoomEvent: (id) => {
    get().updateProject((p) => {
      p.zoomEvents = p.zoomEvents.filter((e) => e.id !== id);
      return p;
    });
    if (get().selectedZoomId === id) set({ selectedZoomId: null });
  },

  // --- captions ---

  addCaption: (caption) => {
    get().updateProject((p) => {
      p.captions.push(caption);
      p.captions.sort((a, b) => a.time - b.time);
      return p;
    });
    set({ selectedCaptionId: caption.id, selectedZoomId: null, selectedClipId: null });
  },

  updateCaption: (id, patch, opts) => {
    get().updateProject((p) => {
      const c = p.captions.find((x) => x.id === id);
      if (c) Object.assign(c, patch);
      return p;
    }, opts);
  },

  removeCaption: (id) => {
    get().updateProject((p) => {
      p.captions = p.captions.filter((x) => x.id !== id);
      return p;
    });
    if (get().selectedCaptionId === id) set({ selectedCaptionId: null });
  },

  // --- annotations ---

  addAnnotation: (annotation) => {
    get().updateProject((p) => {
      p.annotations.push(annotation);
      p.annotations.sort((a, b) => a.time - b.time);
      return p;
    });
    get().selectAnnotation(annotation.id);
  },

  updateAnnotation: (id, patch, opts) => {
    get().updateProject((p) => {
      const a = p.annotations.find((x) => x.id === id);
      if (a) Object.assign(a, patch);
      return p;
    }, opts);
  },

  removeAnnotation: (id) => {
    get().updateProject((p) => {
      p.annotations = p.annotations.filter((x) => x.id !== id);
      return p;
    });
    if (get().selectedAnnotationId === id) set({ selectedAnnotationId: null });
  },

  // --- camera layouts ---

  addLayout: (layout) => {
    get().updateProject((p) => {
      p.layouts = [...(p.layouts || []), layout].sort((a, b) => a.time - b.time);
      return p;
    });
    get().selectLayout(layout.id);
  },

  updateLayout: (id, patch, opts) => {
    get().updateProject((p) => {
      const l = (p.layouts || []).find((x) => x.id === id);
      if (l) Object.assign(l, patch);
      return p;
    }, opts);
  },

  removeLayout: (id) => {
    get().updateProject((p) => {
      p.layouts = (p.layouts || []).filter((x) => x.id !== id);
      return p;
    });
    if (get().selectedLayoutId === id) set({ selectedLayoutId: null });
  },

  // --- clips ---

  setClipSpeed: (clipId, speed) => {
    get().updateProject((p) => {
      const c = p.clips.find((x) => x.id === clipId);
      if (c) c.speed = Math.min(4, Math.max(0.5, Number(speed) || 1));
      return p;
    });
  },

  // Speed up detected typing stretches (source-time segments) in one step.
  speedUpSegments: (segments, speed) => {
    get().updateProject((p) => {
      for (const s of segments) timeline.applySpeedToSourceRange(p, s.start, s.end, speed);
      return p;
    });
    set({ selectedClipId: null });
  },

  splitAtPlayhead: () => {
    const t = get().currentTime;
    get().updateProject((p) => {
      timeline.splitAt(p, t);
      return p;
    });
  },

  trimClip: (clipId, edge, newValue, opts) => {
    get().updateProject((p) => {
      const clip = p.clips.find((c) => c.id === clipId);
      const asset = clip && p.assets.find((a) => a.id === clip.assetId);
      timeline.trimClip(p, clipId, edge, newValue, asset?.duration);
      return p;
    }, opts);
  },

  deleteClip: (clipId) => {
    get().updateProject((p) => {
      timeline.deleteClip(p, clipId);
      return p;
    });
    if (get().selectedClipId === clipId) set({ selectedClipId: null });
  },

  moveClip: (clipId, direction) => {
    get().updateProject((p) => {
      timeline.moveClip(p, clipId, direction);
      return p;
    });
  },

  // Place a video added to the project (projects:add-clip-video) as a new
  // clip at timeline time `at` (see insertIndexAt: into a cut, or splitting
  // the clip there), or at the end; then select it. One undo step.
  addVideoClip: (asset, at) => {
    const id = `clip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    get().updateProject((p) => {
      p.assets.push(asset);
      const index = Number.isFinite(at) ? timeline.insertIndexAt(p, at) : p.clips.length;
      p.clips.splice(index, 0, { id, assetId: asset.id, start: 0, duration: asset.duration, speed: 1 });
      return p;
    });
    set((s) => exclusiveSelection(s, 'selectedClipId', id));
  },

  moveClipTo: (clipId, index) => {
    get().updateProject((p) => {
      timeline.moveClipTo(p, clipId, index);
      return p;
    });
  },

  // The transition into clip `clipId` from the clip before it. `patch` merges
  // into the cut's current transition; null makes the cut follow the default.
  setClipTransition: (clipId, patch, opts) => {
    get().updateProject((p) => {
      const i = p.clips.findIndex((c) => c.id === clipId);
      if (i < 1) return p;
      if (patch === null) delete p.clips[i].transition;
      else p.clips[i].transition = { ...timeline.transitionFor(p.clips, i, p.style.clipTransition), ...patch };
      return p;
    }, opts);
  },

  // Use one transition on every cut: it becomes the default and per-cut
  // choices are cleared.
  setTransitionForAll: (transition) => {
    get().updateProject((p) => {
      p.style.clipTransition = { ...p.style.clipTransition, ...transition };
      for (const c of p.clips) delete c.transition;
      return p;
    });
  },

  // --- transcript ---

  // Cut source ranges (from transcript words) out of every clip; timeline
  // items ripple with the edit. One undo step.
  cutTranscript: (ranges) => {
    if (!ranges || ranges.length === 0) return;
    get().updateProject((p) => {
      cutSourceRanges(p, ranges);
      return p;
    });
    set({ selectedClipId: null, selectedCaptionId: null, selectedZoomId: null, selectedAnnotationId: null, selectedLayoutId: null, selectedTransitionId: null });
  },

  rebuildCaptions: () => {
    get().updateProject((p) => rebuildAutoCaptions(p));
  },

  // --- style / project settings ---

  setStyle: (patch, opts) => {
    get().updateProject((p) => {
      Object.assign(p.style, patch);
      return p;
    }, opts);
  },

  // One undo step: the preset's look over the current style (keys it doesn't
  // have are reset by `base`) and, when it has one, its canvas size.
  applyPreset: (preset, base = {}) => {
    get().updateProject((p) => {
      Object.assign(p.style, base, preset.style);
      if (preset.canvas) {
        p.project.width = preset.canvas.width;
        p.project.height = preset.canvas.height;
      }
      return p;
    });
  },

  setCanvasSize: (width, height) => {
    get().updateProject((p) => {
      p.project.width = width;
      p.project.height = height;
      return p;
    });
  },
}));
