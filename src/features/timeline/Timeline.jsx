import React, { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '../../stores/editor-store.js';
import { clipOffset, clipTimelineLength, isAddedClip, transitionFor } from '../../engine/timeline-engine.js';
import { ANNOTATION_LABELS } from '../../engine/composition-engine.js';
import { TRANSITION_DRAG_TYPE, TransitionGlyph, transitionLabel } from '../editor/panels/TransitionsPanel.jsx';

export const LAYOUT_LABELS = {
  overlay: 'Camera overlay', camera: 'Fullscreen camera', split: 'Split screen', screen: 'Screen only', cutout: 'Camera cutout',
};

// Timeline lanes: ruler (scrub), clips (trim/select), zooms, captions,
// camera layouts (webcam recordings only), annotations. Blocks drag to move
// and edge-drag to resize, with snapping to clip boundaries, other blocks,
// the playhead, and whole seconds. `zoom` stretches the lanes horizontally
// (Ctrl+wheel changes it); the view follows the playhead during playback.

export default function Timeline({ duration, onSeek, zoom = 1, onZoomChange, onAddClip, addingClip = false }) {
  const {
    project,
    currentTime,
    selectedZoomId,
    selectZoom,
    selectedClipId,
    selectClip,
    selectedCaptionId,
    selectCaption,
    selectedAnnotationId,
    selectAnnotation,
    selectedLayoutId,
    selectLayout,
    updateLayout,
    updateZoomEvent,
    updateCaption,
    updateAnnotation,
    trimClip,
    moveClipTo,
    selectedTransitionId,
    selectTransition,
    setClipTransition,
    playing,
  } = useEditorStore();
  const wrapRef = useRef(null);
  const scrollRef = useRef(null);
  const [clipDrag, setClipDrag] = useState(null); // { id, dx (px), target index }
  const [dropCut, setDropCut] = useState(null); // cut a transition is dragged over

  // Keep the playhead in view while playing.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !playing || !duration || zoom <= 1) return;
    const x = (currentTime / duration) * el.scrollWidth;
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 24) el.scrollLeft = Math.max(0, x - 48);
  }, [currentTime, playing, duration, zoom]);

  // Ctrl+wheel zooms the timeline (a native listener: React's wheel
  // handlers are passive and cannot stop the page from scrolling).
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !onZoomChange) return undefined;
    const onWheel = (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      onZoomChange(zoomRef.current * (e.deltaY < 0 ? 1.25 : 0.8));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onZoomChange, Boolean(project)]);

  if (!project || !duration) return null;

  function timeAt(clientX) {
    const rect = wrapRef.current.getBoundingClientRect();
    const f = (clientX - rect.left) / rect.width;
    return Math.min(duration, Math.max(0, f * duration));
  }

  // Snap threshold: ~7 px expressed in seconds.
  function snapThreshold() {
    const rect = wrapRef.current.getBoundingClientRect();
    return (7 / rect.width) * duration;
  }

  function snapPoints(excludeId) {
    const p = useEditorStore.getState().project;
    const pts = [0, duration, useEditorStore.getState().currentTime];
    let off = 0;
    for (const c of p.clips) {
      off += clipTimelineLength(c);
      pts.push(off);
    }
    for (const list of [p.zoomEvents, p.captions, p.annotations, p.layouts]) {
      for (const e of list || []) {
        if (e.id === excludeId) continue;
        pts.push(e.time, e.time + e.duration);
      }
    }
    for (let s = 1; s < duration; s++) pts.push(s);
    return pts;
  }

  function snap(t, excludeId) {
    const th = snapThreshold();
    let best = t;
    let bestD = th;
    for (const pt of snapPoints(excludeId)) {
      const d = Math.abs(pt - t);
      if (d < bestD) {
        bestD = d;
        best = pt;
      }
    }
    return best;
  }

  function scrub(e) {
    onSeek(timeAt(e.clientX));
    const move = (ev) => onSeek(timeAt(ev.clientX));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // --- clip trim handles ----------------------------------------------------
  function onTrimPointerDown(e, clip, edge) {
    e.stopPropagation();
    selectClip(clip.id);
    const index = project.clips.findIndex((c) => c.id === clip.id);
    const laneStart = clipOffset(project.clips, index);

    const move = (ev) => {
      const t = snap(timeAt(ev.clientX), clip.id);
      const p = useEditorStore.getState().project;
      const c = p.clips.find((x) => x.id === clip.id);
      if (!c) return;
      // Timeline delta -> source delta via the clip's speed.
      const speed = c.speed || 1;
      const delta = (t - laneStart) * speed;
      if (edge === 'start') {
        trimClip(clip.id, 'start', c.start + delta, { transient: true });
      } else {
        trimClip(clip.id, 'end', c.start + delta, { transient: true });
      }
    };
    const up = () => {
      // One final non-transient write makes the whole drag a single undo step.
      const c = useEditorStore.getState().project.clips.find((x) => x.id === clip.id);
      if (c) trimClip(clip.id, edge, edge === 'start' ? c.start : c.start + c.duration);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // --- clip drag to reorder -------------------------------------------------
  // Where clip `id` would go if dropped at timeline time t: before the first
  // other clip whose middle lies past t.
  function dropIndex(id, t) {
    let off = 0;
    let index = 0;
    for (const c of project.clips) {
      const len = clipTimelineLength(c);
      if (c.id !== id && off + len / 2 < t) index++;
      off += len;
    }
    return index;
  }

  // Timeline offset of the gap at `index` among the clips other than `id`.
  function insertOffset(id, index) {
    return project.clips
      .filter((c) => c.id !== id)
      .slice(0, index)
      .reduce((sum, c) => sum + clipTimelineLength(c), 0);
  }

  function onClipPointerDown(e, clip) {
    e.stopPropagation();
    selectClip(clip.id);
    onSeek(timeAt(e.clientX));
    const x0 = e.clientX;
    let dragging = false;
    const move = (ev) => {
      const dx = ev.clientX - x0;
      if (!dragging && Math.abs(dx) < 5) return;
      dragging = true;
      setClipDrag({ id: clip.id, dx, target: dropIndex(clip.id, timeAt(ev.clientX)) });
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!dragging) return;
      setClipDrag(null);
      moveClipTo(clip.id, dropIndex(clip.id, timeAt(ev.clientX)));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // The cut (named by the clip after it) nearest timeline time t.
  function nearestCut(t) {
    let best = null;
    let bestD = Infinity;
    let off = 0;
    project.clips.forEach((c, i) => {
      if (i > 0 && Math.abs(off - t) < bestD) {
        bestD = Math.abs(off - t);
        best = c.id;
      }
      off += clipTimelineLength(c);
    });
    return best;
  }

  // --- generic block drag (zooms, captions, annotations) --------------------
  function onBlockPointerDown(e, item, mode, { select, update, minLen }) {
    e.stopPropagation();
    select(item.id);
    const grabOffset = timeAt(e.clientX) - item.time;

    const findItem = () => {
      const p = useEditorStore.getState().project;
      return (
        p.zoomEvents.find((x) => x.id === item.id) ||
        (p.captions || []).find((x) => x.id === item.id) ||
        (p.annotations || []).find((x) => x.id === item.id) ||
        (p.layouts || []).find((x) => x.id === item.id)
      );
    };

    const move = (ev) => {
      const t = timeAt(ev.clientX);
      const cur = findItem();
      if (!cur) return;
      if (mode === 'move') {
        const next = Math.min(Math.max(0, snap(t - grabOffset, item.id)), duration - cur.duration);
        update(item.id, { time: next }, { transient: true });
      } else {
        const end = snap(t, item.id);
        const next = Math.min(Math.max(minLen, end - cur.time), duration - cur.time);
        update(item.id, { duration: next }, { transient: true });
      }
    };
    const up = () => {
      const cur = findItem();
      if (cur) update(item.id, mode === 'move' ? { time: cur.time } : { duration: cur.duration });
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function blockLane({ items, selectedId, select, update, minLen, palette, label }) {
    return (
      <div
        onPointerDown={(e) => {
          select(null);
          scrub(e);
        }}
        className="relative h-9 border-b border-black/40 cursor-pointer"
      >
        {items.map((item) => {
          const left = (item.time / duration) * 100;
          const width = (item.duration / duration) * 100;
          const selected = item.id === selectedId;
          return (
            <div
              key={item.id}
              onPointerDown={(e) => onBlockPointerDown(e, item, 'move', { select, update, minLen })}
              className={`absolute top-1 bottom-1 rounded-[4px] border text-[10.5px] flex items-center px-2 overflow-hidden cursor-grab ${
                selected ? `${palette.selected} z-10` : palette.normal
              }`}
              style={{ left: `${left}%`, width: `max(${width}%, 6px)` }}
            >
              <span className="truncate pointer-events-none">{label(item)}</span>
              <div
                onPointerDown={(e) => onBlockPointerDown(e, item, 'resize', { select, update, minLen })}
                className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/25"
              />
            </div>
          );
        })}
      </div>
    );
  }

  const hasWebcam = project.assets.some((a) => a.type === 'webcam-recording');
  const lanes = [
    { id: 'clips', label: 'Clips', height: 'h-12' },
    { id: 'zoom', label: 'Zoom', height: 'h-9' },
    { id: 'captions', label: 'Captions', height: 'h-9' },
    ...(hasWebcam ? [{ id: 'camera', label: 'Camera', height: 'h-9' }] : []),
    { id: 'notes', label: 'Annotate', height: 'h-9' },
  ];

  // Ruler: a round major step giving ~6-12 labels across the visible width,
  // with minor ticks between.
  const visible = duration / zoom;
  const tickStep = [0.5, 1, 2, 5, 10, 15, 30, 60, 120].find((s) => visible / s <= 12) || 120;
  const ticks = [];
  for (let t = 0; t <= duration + 1e-6; t += tickStep / 5) ticks.push(Math.round(t * 1000) / 1000);

  return (
    <div className="flex min-h-0 select-none">
      <div className="w-[84px] shrink-0 bg-slate-950 border-r border-black/60">
        <div className="h-6 border-b border-black/40" />
        {lanes.map((l) => (
          <div
            key={l.id}
            className={`${l.height} border-b border-black/40 flex items-center justify-between gap-1 pl-3 pr-1.5 text-[11px] text-slate-400`}
          >
            {l.label}
            {l.id === 'clips' && onAddClip && (
              <button
                onClick={onAddClip}
                disabled={addingClip}
                title="Add a video clip at the playhead (splits the clip there)"
                className="w-5 h-5 shrink-0 rounded-[4px] border border-slate-700 flex items-center justify-center text-[13px] leading-none text-slate-300 hover:border-slate-500 hover:text-white disabled:opacity-60"
              >
                {addingClip ? '…' : '+'}
              </button>
            )}
          </div>
        ))}
      </div>

      <div
        ref={scrollRef}
        className="flex-1 min-w-0 overflow-x-auto overflow-y-hidden ff-scroll"
      >
        {/* overflow-x-clip: labels and handles at the very end (e.g. a ruler
            label on the last second) must not widen the scroll area. */}
        <div ref={wrapRef} className="relative overflow-x-clip" style={{ width: `${zoom * 100}%`, minWidth: '100%' }}>
          {/* Ruler (click/drag to scrub) */}
          <div onPointerDown={scrub} className="relative h-6 border-b border-black/40 cursor-pointer">
            {ticks.map((t) => {
              const major = Math.abs(t / tickStep - Math.round(t / tickStep)) < 1e-6;
              return (
                <div
                  key={t}
                  className={`absolute bottom-0 border-l pointer-events-none ${
                    major ? 'h-full border-slate-600' : 'h-1.5 border-slate-700'
                  }`}
                  style={{ left: `${(t / duration) * 100}%` }}
                >
                  {major && <span className="absolute top-0.5 left-1 text-[9.5px] text-slate-500 tabular-nums">{rulerLabel(t)}</span>}
                </div>
              );
            })}
          </div>

          {/* Clip lane: drag a clip to move it, drag its edges to trim, click
              a cut to edit its transition, drop a transition tile on a cut. */}
          <div
            onPointerDown={scrub}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(TRANSITION_DRAG_TYPE)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
              setDropCut(nearestCut(timeAt(e.clientX)));
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget)) setDropCut(null);
            }}
            onDrop={(e) => {
              const type = e.dataTransfer.getData(TRANSITION_DRAG_TYPE);
              const id = nearestCut(timeAt(e.clientX));
              setDropCut(null);
              if (!type || !id) return;
              e.preventDefault();
              setClipTransition(id, { type });
              selectTransition(id);
            }}
            className={`relative h-12 border-b border-black/40 cursor-pointer group/lane ${dropCut ? 'bg-indigo-500/5' : ''}`}
          >
            {project.clips.map((clip, i) => {
              const left = (clipOffset(project.clips, i) / duration) * 100;
              const width = (clipTimelineLength(clip) / duration) * 100;
              const selected = clip.id === selectedClipId;
              const dragged = clipDrag?.id === clip.id;
              const speed = clip.speed || 1;
              const added = isAddedClip(clip);
              const name = added ? project.assets.find((a) => a.id === clip.assetId)?.name || 'Video' : `Clip ${i + 1}`;
              return (
                <div
                  key={clip.id}
                  onPointerDown={(e) => onClipPointerDown(e, clip)}
                  title="Drag to move · drag an edge to trim"
                  className={`absolute top-1 bottom-1 rounded-[4px] border overflow-hidden flex items-center px-3.5 text-[11px] ${
                    dragged ? 'cursor-grabbing opacity-75 z-30 shadow-[0_6px_18px_rgba(0,0,0,0.5)]' : 'cursor-grab'
                  } ${
                    added
                      ? selected
                        ? 'bg-teal-600 border-white/80 text-white z-10'
                        : 'bg-teal-600/30 border-teal-400/60 text-teal-50 hover:bg-teal-600/45'
                      : selected
                        ? 'bg-indigo-600 border-white/80 text-white z-10'
                        : 'bg-indigo-600/30 border-indigo-400/60 text-indigo-50 hover:bg-indigo-600/45'
                  }`}
                  style={{
                    left: `${left}%`,
                    width: `max(${width}%, 6px)`,
                    transform: dragged ? `translateX(${clipDrag.dx}px)` : undefined,
                  }}
                >
                  <span className="truncate pointer-events-none">
                    {name} · {clipTimelineLength(clip).toFixed(1)}s{speed !== 1 ? ` · ${speed}×` : ''}
                  </span>
                  <TrimGrip side="left" onPointerDown={(e) => onTrimPointerDown(e, clip, 'start')} />
                  <TrimGrip side="right" onPointerDown={(e) => onTrimPointerDown(e, clip, 'end')} />
                </div>
              );
            })}

            {/* Where a dragged clip will land. */}
            {clipDrag && (
              <div
                className="absolute top-0 bottom-0 w-0.5 -translate-x-1/2 bg-amber-400 z-40 pointer-events-none"
                style={{ left: `${(insertOffset(clipDrag.id, clipDrag.target) / duration) * 100}%` }}
              />
            )}

            {/* Cuts: the transition band and a marker to edit or drop onto. */}
            {project.clips.map((clip, i) => {
              if (i === 0) return null;
              const at = clipOffset(project.clips, i);
              const tr = transitionFor(project.clips, i, project.style.clipTransition);
              const half = Math.min(tr.duration / 2, clipTimelineLength(project.clips[i - 1]) / 2, clipTimelineLength(clip) / 2);
              const selected = clip.id === selectedTransitionId;
              const hot = clip.id === dropCut;
              return (
                <React.Fragment key={`cut-${clip.id}`}>
                  {tr.type !== 'none' && (
                    <div
                      className="absolute top-1 bottom-1 z-[15] pointer-events-none rounded-[3px] bg-[repeating-linear-gradient(135deg,rgba(255,255,255,0.16)_0_4px,transparent_4px_8px)]"
                      style={{ left: `${((at - half) / duration) * 100}%`, width: `${((half * 2) / duration) * 100}%` }}
                    />
                  )}
                  <button
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => selectTransition(clip.id)}
                    title={tr.type === 'none' ? 'Add a transition (or drop one here)' : `${transitionLabel(tr.type)} · ${tr.duration.toFixed(1)}s — click to edit`}
                    className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 h-6 min-w-5 px-1 rounded-[5px] border flex items-center justify-center text-[12px] leading-none transition-transform ${
                      selected
                        ? 'bg-indigo-500 border-white text-white'
                        : tr.type !== 'none'
                          ? 'bg-slate-900 border-slate-400 hover:border-white'
                          : 'bg-slate-900/90 border-slate-600 text-slate-300 opacity-60 group-hover/lane:opacity-100 hover:border-slate-300'
                    } ${hot ? 'scale-125 !opacity-100 ring-2 ring-amber-400' : ''}`}
                    style={{ left: `${(at / duration) * 100}%` }}
                  >
                    {tr.type === 'none' ? '+' : <TransitionGlyph type={tr.type} size={18} />}
                  </button>
                </React.Fragment>
              );
            })}
          </div>

          {blockLane({
            items: project.zoomEvents,
            selectedId: selectedZoomId,
            select: selectZoom,
            update: updateZoomEvent,
            minLen: 0.8,
            label: (z) => `${z.type === 'loupe' ? 'Loupe' : 'Zoom'} ${z.scale.toFixed(1)}×${z.auto ? ' · auto' : ''}`,
            palette: {
              selected: 'bg-violet-500 border-white/80 text-white',
              normal: 'bg-violet-500/25 border-violet-400/60 text-violet-100 hover:bg-violet-500/40',
            },
          })}

          {blockLane({
            items: project.captions || [],
            selectedId: selectedCaptionId,
            select: selectCaption,
            update: updateCaption,
            minLen: 0.5,
            label: (c) => c.text,
            palette: {
              selected: 'bg-amber-500 border-white/80 text-slate-950',
              normal: 'bg-amber-500/20 border-amber-400/60 text-amber-100 hover:bg-amber-500/35',
            },
          })}

          {hasWebcam &&
            blockLane({
              items: project.layouts || [],
              selectedId: selectedLayoutId,
              select: selectLayout,
              update: updateLayout,
              minLen: 1,
              label: (l) => LAYOUT_LABELS[l.layout] || l.layout,
              palette: {
                selected: 'bg-rose-500 border-white/80 text-white',
                normal: 'bg-rose-500/20 border-rose-400/60 text-rose-100 hover:bg-rose-500/35',
              },
            })}

          {blockLane({
            items: project.annotations || [],
            selectedId: selectedAnnotationId,
            select: selectAnnotation,
            update: updateAnnotation,
            minLen: 0.5,
            label: (a) => (a.type === 'text' ? a.text || 'Text' : ANNOTATION_LABELS[a.type] || 'Box'),
            palette: {
              selected: 'bg-emerald-500 border-white/80 text-slate-950',
              normal: 'bg-emerald-500/20 border-emerald-400/60 text-emerald-100 hover:bg-emerald-500/35',
            },
          })}

          {/* Playhead across all lanes */}
          <div
            className="absolute top-0 bottom-0 w-px bg-indigo-400 z-20 pointer-events-none"
            style={{ left: `${(currentTime / duration) * 100}%` }}
          >
            <div className="absolute -top-px -left-[5px] w-[11px] h-3 bg-indigo-400 [clip-path:polygon(0_0,100%_0,100%_55%,50%_100%,0_55%)]" />
          </div>
        </div>
      </div>
    </div>
  );
}

// Trim handle on a clip edge: a visible grip, wider than it looks.
function TrimGrip({ side, onPointerDown }) {
  return (
    <div
      onPointerDown={onPointerDown}
      title={side === 'left' ? 'Drag to trim the start' : 'Drag to trim the end'}
      className={`absolute ${side === 'left' ? 'left-0' : 'right-0'} top-0 bottom-0 w-2.5 cursor-ew-resize flex items-center justify-center bg-white/10 hover:bg-white/35`}
    >
      <span className="w-[2px] h-4 rounded-full bg-white/70 pointer-events-none" />
    </div>
  );
}

function rulerLabel(t) {
  if (t >= 60) return `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;
  return Number.isInteger(t) ? `${t}s` : `${t.toFixed(1)}s`;
}
