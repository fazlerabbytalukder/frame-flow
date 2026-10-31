import React from 'react';
import { useEditorStore } from '../../../stores/editor-store.js';
import { ANNOTATION_LABELS } from '../../../engine/composition-engine.js';
import { useEditorActions } from '../editor-context.js';
import { Hint, Section } from './controls.jsx';
import { ItemList } from './ItemList.jsx';

export const ANNOTATION_TOOLS = [
  { type: 'text', label: 'Text', hint: 'A label on the screen' },
  { type: 'arrow', label: 'Arrow', hint: 'Point at something' },
  { type: 'rect', label: 'Box', hint: 'Outline an area' },
  { type: 'blur', label: 'Blur', hint: 'Pixelate sensitive data' },
  { type: 'spotlight', label: 'Spotlight', hint: 'Dim everything else' },
];

export default function AnnotatePanel() {
  const annotations = useEditorStore((s) => s.project.annotations) || [];
  const selectedAnnotationId = useEditorStore((s) => s.selectedAnnotationId);
  const selectAnnotation = useEditorStore((s) => s.selectAnnotation);
  const actions = useEditorActions();

  return (
    <>
      <Section title="Add">
        <div className="grid grid-cols-2 gap-1.5">
          {ANNOTATION_TOOLS.map((t) => (
            <button
              key={t.type}
              onClick={() => actions.addAnnotation(t.type)}
              className="text-left rounded-[5px] border border-slate-700 bg-slate-950 hover:border-slate-500 px-2.5 py-2"
            >
              <span className="block text-[12.5px] text-slate-100">{t.label}</span>
              <span className="block text-[10.5px] text-slate-500">{t.hint}</span>
            </button>
          ))}
        </div>
        <Hint>New annotations start at the playhead. Click or drag on the preview to place them.</Hint>
      </Section>
      <Section title={`On the timeline (${annotations.length})`}>
        <ItemList
          items={annotations}
          selectedId={selectedAnnotationId}
          empty="No annotations yet."
          label={(a) => (a.type === 'text' ? a.text || 'Text' : ANNOTATION_LABELS[a.type] || 'Box')}
          onPick={(a) => {
            selectAnnotation(a.id);
            actions.seek(a.time);
          }}
        />
      </Section>
    </>
  );
}
