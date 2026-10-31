import React from 'react';
import { useEditorStore } from '../../../stores/editor-store.js';
import { PlusIcon } from '../../../ui/icons.jsx';
import { captionSettings, shiftHue } from '../../../engine/composition-engine.js';
import { useEditorActions } from '../editor-context.js';
import { Button, ColorField, Hint, Label, Section, Slider, Toggle } from './controls.jsx';
import { ItemList } from './ItemList.jsx';
import { TranscribeForm } from './TranscriptPanel.jsx';

// Tile previews mirror the canvas renderer (composition-engine drawCaption).
const STROKE = (w) => ({ WebkitTextStroke: `${w}px #000`, paintOrder: 'stroke' });
const LOOKS = [
  { id: 'pill', label: 'Pill', sample: () => ({ background: 'rgba(10,12,18,.72)', borderRadius: 999, fontWeight: 600 }) },
  { id: 'glass', label: 'Glass', sample: () => ({ background: 'rgba(255,255,255,.16)', border: '1px solid rgba(255,255,255,.35)', backdropFilter: 'blur(4px)', borderRadius: 6, fontWeight: 600 }) },
  { id: 'card', label: 'Card', sample: () => ({ background: '#fff', color: '#111827', borderRadius: 4, fontWeight: 700, boxShadow: '0 2px 6px rgba(0,0,0,.4)' }) },
  { id: 'bold', label: 'Bold', sample: () => ({ fontWeight: 800, ...STROKE(1.5) }) },
  { id: 'outline', label: 'Outline', sample: () => ({ fontWeight: 700, ...STROKE(1) }) },
  { id: 'punch', label: 'Punch', sample: () => ({ fontWeight: 900, fontSize: 13, ...STROKE(2), textShadow: '1.5px 2px 0 #000' }) },
  { id: 'neon', label: 'Neon', sample: (c) => ({ fontWeight: 700, color: '#fff', textShadow: `0 0 3px ${c}, 0 0 8px ${c}, 0 0 14px ${c}` }) },
  { id: 'gradient', label: 'Gradient', sample: (c) => ({ fontWeight: 800, fontSize: 13, color: 'transparent', backgroundImage: `linear-gradient(135deg, ${c}, ${shiftHue(c, 70)})`, WebkitBackgroundClip: 'text', backgroundClip: 'text', filter: 'drop-shadow(0 1px 1px rgba(0,0,0,.6))' }) },
  { id: 'highlight', label: 'Highlight', sample: (c) => ({ background: c, borderRadius: 3, fontWeight: 700 }) },
  { id: 'lines', label: 'Subtitle', sample: () => ({ background: 'rgba(0,0,0,.78)', borderRadius: 2, fontWeight: 600 }) },
  { id: 'news', label: 'Lower third', sample: (c) => ({ background: 'rgba(14,17,24,.9)', borderLeft: `3px solid ${c}`, borderRadius: 2, fontWeight: 600 }) },
  { id: 'minimal', label: 'Minimal', sample: () => ({ fontWeight: 500, textShadow: '0 1px 4px rgba(0,0,0,.8)' }) },
];

const ANIMATIONS = [
  { id: 'none', label: 'None' },
  { id: 'fade', label: 'Fade' },
  { id: 'pop', label: 'Pop' },
  { id: 'rise', label: 'Rise up' },
  { id: 'words', label: 'Word by word' },
  { id: 'wordpop', label: 'Word pop' },
  { id: 'karaoke', label: 'Karaoke' },
];

export default function CaptionsPanel() {
  const project = useEditorStore((s) => s.project);
  const captions = project.captions || [];
  const selectedCaptionId = useEditorStore((s) => s.selectedCaptionId);
  const selectCaption = useEditorStore((s) => s.selectCaption);
  const setStyle = useEditorStore((s) => s.setStyle);
  const rebuildCaptions = useEditorStore((s) => s.rebuildCaptions);
  const actions = useEditorActions();
  const look = captionSettings(project.style);
  const setCaptions = (patch, o) => setStyle({ captions: { ...look, ...patch } }, o);

  return (
    <>
      <Section title="Captions from speech">
        {project.transcript ? (
          <>
            <Button tone="primary" className="w-full" onClick={rebuildCaptions}>
              {project.transcript.captions ? 'Rebuild from transcript' : 'Create captions from transcript'}
            </Button>
            <Hint>Made from the transcript on this computer. Edits in the Transcript panel keep them in sync.</Hint>
          </>
        ) : (
          <>
            <TranscribeForm project={project} cta="Transcribe and create captions" captionsDefault />
            <Hint>Speech recognition runs on this computer (Whisper). The audio is never uploaded.</Hint>
          </>
        )}
      </Section>

      <Section title="Style">
        <div className="grid grid-cols-3 gap-1.5">
          {LOOKS.map((l) => (
            <button
              key={l.id}
              onClick={() => setCaptions({ look: l.id })}
              title={l.label}
              className={`h-14 rounded-[6px] border flex flex-col items-center justify-center gap-1.5 overflow-hidden bg-[linear-gradient(135deg,#3a4763_0%,#1d222e_55%,#4a3a5e_100%)] ${
                look.look === l.id ? 'border-indigo-500 ring-1 ring-indigo-500' : 'border-slate-700 hover:border-slate-500'
              }`}
            >
              <span className="text-[11px] leading-none px-1.5 py-[3px] text-white" style={l.sample(look.color)}>
                Aa
              </span>
              <span className="text-[10px] text-slate-300">{l.label}</span>
            </button>
          ))}
        </div>
        <div>
          <Label>Animation</Label>
          <select
            value={look.animation}
            onChange={(e) => setCaptions({ animation: e.target.value })}
            className="w-full h-8 px-2 rounded-[5px] bg-slate-950 border border-slate-700 text-[12px] text-slate-200 outline-none focus:border-indigo-500"
          >
            {ANIMATIONS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
        <Slider label="Size" value={look.size} min={0.6} max={1.8} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v, o) => setCaptions({ size: v }, o)} />
        <ColorField label="Accent colour" value={look.color} onChange={(v) => setCaptions({ color: v })} />
        <Toggle label="Uppercase" checked={look.uppercase} onChange={(v) => setCaptions({ uppercase: v })} />
        {(look.animation === 'words' || look.animation === 'karaoke') && (
          <Hint>Word timing comes from the transcript; typed captions spread their words evenly.</Hint>
        )}
      </Section>

      <Section title={`Captions (${captions.length})`}>
        <Button className="w-full" onClick={actions.addCaptionAtPlayhead}>
          <PlusIcon size={14} /> Caption at playhead
        </Button>
        <ItemList
          items={captions}
          selectedId={selectedCaptionId}
          empty="No captions yet."
          label={(c) => c.text}
          onPick={(c) => {
            selectCaption(c.id);
            actions.seek(c.time);
          }}
        />
        <Hint>Captions are burned into the video. Export can also write a separate .srt subtitle file.</Hint>
      </Section>
    </>
  );
}
