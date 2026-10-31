import React, { useEffect, useState } from 'react';
import { useEditorStore } from '../../../stores/editor-store.js';
import { ASPECTS, aspectOf } from '../editor-context.js';
import { Label, Section } from './controls.jsx';

// Project-wide settings: name and canvas shape (transitions have their own panel).

export default function SettingsPanel() {
  const project = useEditorStore((s) => s.project);
  const setCanvasSize = useEditorStore((s) => s.setCanvasSize);
  const updateProject = useEditorStore((s) => s.updateProject);
  const [name, setName] = useState(project.project.name);
  useEffect(() => setName(project.project.name), [project.project.name]);
  const active = aspectOf(project);

  function commitName() {
    const next = name.trim().slice(0, 120);
    if (!next || next === project.project.name) {
      setName(project.project.name);
      return;
    }
    updateProject((p) => {
      p.project.name = next;
      return p;
    });
  }

  return (
    <>
      <Section title="Project">
        <div>
          <Label>Name</Label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            className="w-full h-8 px-2.5 rounded-[5px] bg-slate-950 border border-slate-700 focus:border-indigo-500 outline-none text-[12.5px] text-slate-100"
          />
        </div>
      </Section>

      <Section title="Canvas">
        <div className="grid grid-cols-3 gap-1.5">
          {ASPECTS.map((a) => (
            <button
              key={a.id}
              onClick={() => setCanvasSize(a.width, a.height)}
              title={a.hint}
              className={`rounded-[5px] border py-2 text-[11.5px] ${
                active?.id === a.id
                  ? 'border-indigo-500 bg-indigo-500/10 text-white'
                  : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500'
              }`}
            >
              <AspectGlyph width={a.width} height={a.height} />
              {a.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-slate-500">
          {project.project.width} × {project.project.height}
        </p>
      </Section>
    </>
  );
}

export function AspectGlyph({ width, height, size = 20 }) {
  return (
    <span
      className="mx-auto mb-1 block border-[1.5px] border-current rounded-[2px]"
      style={{
        width: width >= height ? size : size * (width / height),
        height: height >= width ? size : size * (height / width),
      }}
    />
  );
}
