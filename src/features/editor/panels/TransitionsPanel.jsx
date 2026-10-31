import React from 'react';
import { useEditorStore } from '../../../stores/editor-store.js';
import { transitionFor } from '../../../engine/timeline-engine.js';
import { Button, Hint, Label, Section, SelectionCard, Slider } from './controls.jsx';

// Transitions between clips. Tiles drag onto the cuts in the timeline's clip
// lane (or click a cut there to edit it here); the default applies to every
// cut that has no transition of its own.

export const TRANSITION_DRAG_TYPE = 'application/x-frame-studio-transition';

export const TRANSITIONS = [
  { id: 'none', label: 'Cut' },
  { id: 'fade', label: 'Fade' },
  { id: 'black', label: 'Dip to black' },
  { id: 'white', label: 'Flash' },
  { id: 'zoom', label: 'Zoom' },
  { id: 'slide', label: 'Slide' },
  { id: 'slideUp', label: 'Slide up' },
  { id: 'blur', label: 'Blur' },
  { id: 'wipe', label: 'Wipe' },
];

export const transitionLabel = (type) => TRANSITIONS.find((t) => t.id === type)?.label || 'Cut';

// A tiny picture of the transition: clip A (blue) handing over to clip B (amber).
export function TransitionGlyph({ type, size = 26 }) {
  const A = '#4b9cf5';
  const B = '#f5a524';
  const h = size * 0.62;
  const box = { width: size, height: h };
  const common = { position: 'absolute', top: 0, bottom: 0, borderRadius: 2 };
  let body;
  switch (type) {
    case 'fade':
      body = <span style={{ ...common, left: 0, right: 0, background: `linear-gradient(90deg, ${A}, transparent 50%, ${B})` }} />;
      break;
    case 'black':
    case 'white': {
      const mid = type === 'black' ? '#000' : '#fff';
      body = <span style={{ ...common, left: 0, right: 0, background: `linear-gradient(90deg, ${A}, ${mid} 50%, ${B})` }} />;
      break;
    }
    case 'zoom':
      body = (
        <>
          <span style={{ ...common, left: 0, right: 0, background: A, opacity: 0.45 }} />
          <span style={{ ...common, left: '28%', right: '28%', top: '22%', bottom: '22%', background: B }} />
        </>
      );
      break;
    case 'slide':
      body = (
        <>
          <span style={{ ...common, left: 0, width: '46%', background: A }} />
          <span style={{ ...common, left: '54%', right: 0, background: B }} />
          <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-white">←</span>
        </>
      );
      break;
    case 'slideUp':
      body = (
        <>
          <span style={{ ...common, left: 0, right: 0, bottom: '54%', background: A }} />
          <span style={{ ...common, left: 0, right: 0, top: '54%', background: B }} />
        </>
      );
      break;
    case 'blur':
      body = (
        <>
          <span style={{ ...common, left: 0, width: '50%', background: A, filter: 'blur(1.5px)' }} />
          <span style={{ ...common, left: '50%', right: 0, background: B, filter: 'blur(1.5px)' }} />
        </>
      );
      break;
    case 'wipe':
      body = (
        <>
          <span style={{ ...common, left: 0, right: 0, background: A }} />
          <span style={{ ...common, left: 0, width: '55%', background: B }} />
          <span style={{ ...common, left: '55%', width: 1.5, background: '#fff' }} />
        </>
      );
      break;
    default:
      body = (
        <>
          <span style={{ ...common, left: 0, width: '48%', background: A }} />
          <span style={{ ...common, left: '52%', right: 0, background: B }} />
        </>
      );
  }
  return (
    <span className="relative inline-block shrink-0" style={box}>
      {body}
    </span>
  );
}

function TransitionTile({ t, selected, onPick }) {
  return (
    <button
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(TRANSITION_DRAG_TYPE, t.id);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={onPick}
      title={`${t.label} — drag onto a cut in the timeline`}
      className={`h-[54px] rounded-[6px] border flex flex-col items-center justify-center gap-1.5 bg-slate-900 cursor-grab active:cursor-grabbing ${
        selected ? 'border-indigo-500 ring-1 ring-indigo-500' : 'border-slate-700 hover:border-slate-500'
      }`}
    >
      <TransitionGlyph type={t.id} />
      <span className="text-[10px] text-slate-300">{t.label}</span>
    </button>
  );
}

function TransitionGrid({ value, onPick }) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {TRANSITIONS.map((t) => (
        <TransitionTile key={t.id} t={t} selected={value === t.id} onPick={() => onPick(t.id)} />
      ))}
    </div>
  );
}

const durationFormat = (v) => `${v.toFixed(1)}s`;

export default function TransitionsPanel() {
  const project = useEditorStore((s) => s.project);
  const setTransitionForAll = useEditorStore((s) => s.setTransitionForAll);
  const setStyle = useEditorStore((s) => s.setStyle);
  const def = transitionFor([], 0, project.style.clipTransition);
  const cuts = project.clips.length - 1;
  const custom = project.clips.filter((c, i) => i > 0 && c.transition).length;

  return (
    <Section title="Transitions">
      <TransitionGrid value={def.type} onPick={(type) => setStyle({ clipTransition: { ...def, type } })} />
      <Hint>
        Drag a transition onto a cut in the clip lane, or click a tile to make it the default for every cut without its own.
        Press S to split a clip at the playhead.
      </Hint>
      {def.type !== 'none' && (
        <Slider
          label="Default length"
          value={def.duration}
          min={0.1}
          max={2}
          step={0.05}
          format={durationFormat}
          onChange={(v, o) => setStyle({ clipTransition: { ...def, duration: v } }, o)}
        />
      )}
      <Label>
        {cuts === 0 ? 'No cuts yet' : `${cuts} cut${cuts === 1 ? '' : 's'}`}
        {custom > 0 ? ` · ${custom} with their own transition` : ''}
      </Label>
      {custom > 0 && (
        <Button className="w-full" onClick={() => setTransitionForAll(def)}>
          Use “{transitionLabel(def.type)}” on every cut
        </Button>
      )}
    </Section>
  );
}

// Selection editor for one cut (the transition into clip `selectedTransitionId`).
export function TransitionEditor() {
  const project = useEditorStore((s) => s.project);
  const id = useEditorStore((s) => s.selectedTransitionId);
  const { setClipTransition, selectTransition, setTransitionForAll } = useEditorStore.getState();
  const i = project.clips.findIndex((c) => c.id === id);
  if (i < 1) return null;
  const clip = project.clips[i];
  const tr = transitionFor(project.clips, i, project.style.clipTransition);
  return (
    <SelectionCard
      title={`Transition · Clip ${i} → Clip ${i + 1}`}
      onDone={() => selectTransition(null)}
      onDelete={tr.type === 'none' ? null : () => setClipTransition(clip.id, { type: 'none' })}
      deleteLabel="Remove transition"
    >
      <TransitionGrid value={tr.type} onPick={(type) => setClipTransition(clip.id, { type })} />
      {tr.type !== 'none' && (
        <Slider
          label="Length"
          value={tr.duration}
          min={0.1}
          max={2}
          step={0.05}
          format={durationFormat}
          onChange={(v, o) => setClipTransition(clip.id, { duration: v }, o)}
        />
      )}
      <div className="grid grid-cols-2 gap-1.5">
        <Button onClick={() => setTransitionForAll(tr)} disabled={project.clips.length < 3}>
          Use on all cuts
        </Button>
        <Button onClick={() => setClipTransition(clip.id, null)} disabled={!clip.transition}>
          Use default
        </Button>
      </div>
    </SelectionCard>
  );
}
