import React from 'react';
import { useEditorStore } from '../../../stores/editor-store.js';
import { ANNOTATION_COLORS, ANNOTATION_LABELS } from '../../../engine/composition-engine.js';
import { clipTimelineLength } from '../../../engine/timeline-engine.js';
import { Button, Hint, Label, Section, Segmented, SelectionCard, Slider, Toggle } from './controls.jsx';
import { LAYOUT_OPTIONS } from './CameraPanel.jsx';
import { TransitionEditor } from './TransitionsPanel.jsx';

// Editing for whatever is selected on the timeline. Returns null when
// nothing is selected, so the side panel shows its normal section.

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

export function useSelection() {
  return useEditorStore((s) => {
    if (s.selectedZoomId) return 'zoom';
    if (s.selectedClipId) return 'clip';
    if (s.selectedCaptionId) return 'caption';
    if (s.selectedAnnotationId) return 'annotation';
    if (s.selectedLayoutId) return 'layout';
    if (s.selectedTransitionId) return 'transition';
    return null;
  });
}

export default function SelectionPanel() {
  const kind = useSelection();
  if (!kind) return null;
  const Editor = { zoom: ZoomEditor, clip: ClipEditor, caption: CaptionEditor, annotation: AnnotationEditor, layout: LayoutEditor, transition: TransitionEditor }[kind];
  return (
    <Section title="Selection">
      <Editor />
    </Section>
  );
}

function span(item) {
  return `${item.time.toFixed(1)}s → ${(item.time + item.duration).toFixed(1)}s`;
}

function ZoomEditor() {
  const project = useEditorStore((s) => s.project);
  const id = useEditorStore((s) => s.selectedZoomId);
  const { updateZoomEvent, removeZoomEvent, selectZoom } = useEditorStore.getState();
  const zoom = project.zoomEvents.find((z) => z.id === id);
  if (!zoom) return null;
  const set = (patch, o) => updateZoomEvent(zoom.id, patch, o);
  const classic = (project.style.animation?.screen || 'classic') === 'classic';
  return (
    <SelectionCard title={`Zoom · ${span(zoom)}`} onDone={() => selectZoom(null)} onDelete={() => removeZoomEvent(zoom.id)} deleteLabel="Delete zoom">
      <Segmented
        options={[
          { id: 'screen', label: 'Classic zoom' },
          { id: 'loupe', label: 'Loupe zoom' },
        ]}
        value={zoom.type === 'loupe' ? 'loupe' : 'screen'}
        onChange={(t) => set({ type: t })}
      />
      {zoom.type === 'loupe' && (
        <Slider
          label="Lens size"
          value={zoom.radius ?? 0.18}
          min={0.08}
          max={0.35}
          step={0.01}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v, o) => set({ radius: v }, o)}
        />
      )}
      <Slider
        label="Scale"
        value={zoom.scale}
        min={1.1}
        max={3}
        step={0.05}
        format={(v) => `${v.toFixed(2)}×`}
        onChange={(v, o) => set({ scale: v }, o)}
      />
      <Slider
        label="Focus X"
        value={zoom.x}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v, o) => set({ x: v }, o)}
      />
      <Slider
        label="Focus Y"
        value={zoom.y}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v, o) => set({ y: v }, o)}
      />
      {classic && (
        <Slider
          label="Transition"
          value={zoom.transition}
          min={0.2}
          max={2}
          step={0.1}
          format={(v) => `${v.toFixed(1)}s`}
          onChange={(v, o) => set({ transition: v }, o)}
        />
      )}
      <Toggle label="Follow the cursor" checked={Boolean(zoom.follow)} onChange={(v) => set({ follow: v })} />
      <Hint>Click the preview to set where the zoom focuses.</Hint>
    </SelectionCard>
  );
}

function ClipEditor() {
  const project = useEditorStore((s) => s.project);
  const id = useEditorStore((s) => s.selectedClipId);
  const { setClipSpeed, moveClip, deleteClip, selectClip } = useEditorStore.getState();
  const clip = project.clips.find((c) => c.id === id);
  if (!clip) return null;
  const index = project.clips.indexOf(clip);
  return (
    <SelectionCard
      title={`Clip ${index + 1} of ${project.clips.length}`}
      onDone={() => selectClip(null)}
      onDelete={project.clips.length > 1 ? () => deleteClip(clip.id) : null}
      deleteLabel="Delete clip"
    >
      <div className="text-[11.5px] text-slate-400 space-y-0.5">
        <div>{clipTimelineLength(clip).toFixed(1)}s on the timeline</div>
        <div>
          Source {clip.start.toFixed(1)}s → {(clip.start + clip.duration).toFixed(1)}s
        </div>
      </div>
      <div>
        <Label>Speed</Label>
        <div className="grid grid-cols-4 gap-1">
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => setClipSpeed(clip.id, s)}
              className={`rounded-[4px] border py-1 text-[11px] ${
                (clip.speed || 1) === s
                  ? 'border-indigo-500 bg-indigo-500/15 text-white'
                  : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500'
              }`}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <Button onClick={() => moveClip(clip.id, -1)} disabled={index === 0}>
          Move earlier
        </Button>
        <Button onClick={() => moveClip(clip.id, 1)} disabled={index === project.clips.length - 1}>
          Move later
        </Button>
      </div>
    </SelectionCard>
  );
}

function CaptionEditor() {
  const project = useEditorStore((s) => s.project);
  const id = useEditorStore((s) => s.selectedCaptionId);
  const { updateCaption, removeCaption, selectCaption } = useEditorStore.getState();
  const caption = (project.captions || []).find((c) => c.id === id);
  if (!caption) return null;
  return (
    <SelectionCard title={`Caption · ${span(caption)}`} onDone={() => selectCaption(null)} onDelete={() => removeCaption(caption.id)} deleteLabel="Delete caption">
      <textarea
        value={caption.text}
        onChange={(e) => updateCaption(caption.id, { text: e.target.value.slice(0, 500) }, { transient: true })}
        onBlur={() => updateCaption(caption.id, { text: caption.text })}
        rows={3}
        className="w-full rounded-[5px] bg-slate-950 border border-slate-700 focus:border-indigo-500 outline-none px-2.5 py-2 text-[12.5px] text-slate-100 resize-none"
      />
      <Hint>Drag the block on the timeline to move it, or its right edge to resize.</Hint>
    </SelectionCard>
  );
}

function AnnotationEditor() {
  const project = useEditorStore((s) => s.project);
  const id = useEditorStore((s) => s.selectedAnnotationId);
  const { updateAnnotation, removeAnnotation, selectAnnotation } = useEditorStore.getState();
  const a = (project.annotations || []).find((x) => x.id === id);
  if (!a) return null;
  const masked = a.type === 'blur' || a.type === 'spotlight';
  return (
    <SelectionCard
      title={`${ANNOTATION_LABELS[a.type] || 'Annotation'} · ${span(a)}`}
      onDone={() => selectAnnotation(null)}
      onDelete={() => removeAnnotation(a.id)}
    >
      {a.type === 'text' && (
        <input
          value={a.text || ''}
          onChange={(e) => updateAnnotation(a.id, { text: e.target.value.slice(0, 200) }, { transient: true })}
          onBlur={() => updateAnnotation(a.id, { text: a.text })}
          className="w-full h-8 rounded-[5px] bg-slate-950 border border-slate-700 focus:border-indigo-500 outline-none px-2.5 text-[12.5px] text-slate-100"
        />
      )}
      {a.type === 'spotlight' && (
        <Slider
          label="Dim outside"
          value={a.dim ?? 0.6}
          min={0.2}
          max={0.85}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v, o) => updateAnnotation(a.id, { dim: v }, o)}
        />
      )}
      {!masked && (
        <div className="flex gap-2">
          {ANNOTATION_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => updateAnnotation(a.id, { color: c })}
              title={c}
              className={`w-6 h-6 rounded-full ring-offset-2 ring-offset-slate-900 ${
                (a.color || ANNOTATION_COLORS[0]) === c ? 'ring-2 ring-indigo-500' : 'ring-1 ring-black/40'
              }`}
              style={{ background: c }}
            />
          ))}
        </div>
      )}
      <Hint>
        {a.type === 'text' ? 'Click' : 'Drag'} on the preview to place it. Drag its block on the timeline to retime it.
      </Hint>
    </SelectionCard>
  );
}

function LayoutEditor() {
  const project = useEditorStore((s) => s.project);
  const id = useEditorStore((s) => s.selectedLayoutId);
  const { updateLayout, removeLayout, selectLayout } = useEditorStore.getState();
  const layout = (project.layouts || []).find((l) => l.id === id);
  if (!layout) return null;
  return (
    <SelectionCard title={`Camera layout · ${span(layout)}`} onDone={() => selectLayout(null)} onDelete={() => removeLayout(layout.id)}>
      <div className="grid grid-cols-2 gap-1.5">
        {LAYOUT_OPTIONS.map((o) => (
          <button
            key={o.id}
            onClick={() => updateLayout(layout.id, { layout: o.id })}
            className={`h-8 rounded-[5px] border text-[12px] ${
              layout.layout === o.id
                ? 'border-indigo-500 bg-indigo-500/15 text-slate-100'
                : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <Hint>Drag the block on the timeline to move or resize it.</Hint>
    </SelectionCard>
  );
}
