import React, { useEffect, useState } from 'react';
import { useEditorStore } from '../../stores/editor-store.js';
import { BookmarkIcon, ChevronDownIcon, SettingsIcon } from '../../ui/icons.jsx';
import Menu from './Menu.jsx';
import { presetFromProject, presetMatches } from './presets.js';

// Presets: the user's saved looks (stored by the main process, shareable as
// files) plus a few starter looks. A preset holds the visual style, camera
// settings and canvas size; project media such as a background image or
// music is never part of one. Applying is one undo step.

const FRAME_RESET = { paddingY: null, frameless: false, backgroundBlur: 0, inset: { size: 0 } };

export const BUILT_IN_PRESETS = [
  {
    name: 'Studio',
    style: { ...FRAME_RESET, background: 'wall-steel', padding: 0.07, cornerRadius: 18, shadow: true, shadowStyle: {} },
  },
  {
    name: 'Graphite',
    style: { ...FRAME_RESET, background: 'wall-graphite', padding: 0.06, cornerRadius: 12, shadow: true, shadowStyle: { opacity: 0.7 } },
  },
  {
    name: 'Paper',
    style: { ...FRAME_RESET, background: 'wall-paper', padding: 0.08, cornerRadius: 14, shadow: true, shadowStyle: { opacity: 0.3, blur: 0.06 } },
  },
  {
    name: 'Spotlight',
    style: { ...FRAME_RESET, background: 'wall-dusk', backgroundBlur: 0.3, padding: 0.1, cornerRadius: 24, shadow: true, shadowStyle: { distance: 0.03, opacity: 0.65 } },
  },
  {
    name: 'Device',
    style: { ...FRAME_RESET, background: 'wall-carbon', padding: 0.08, cornerRadius: 22, shadow: true, shadowStyle: {}, inset: { size: 0.014, color: 'dark' } },
  },
  {
    name: 'Edge to edge',
    style: { ...FRAME_RESET, frameless: true },
  },
];

const INPUT =
  'flex-1 min-w-0 h-8 px-2.5 rounded-[5px] bg-slate-950 border border-slate-700 focus:border-indigo-500 outline-none text-[12px] text-slate-100 placeholder:text-slate-500';

function errorText(err) {
  return String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

export default function PresetsMenu() {
  const project = useEditorStore((s) => s.project);
  const applyPreset = useEditorStore((s) => s.applyPreset);
  const [themes, setThemes] = useState([]);
  const [name, setName] = useState('');
  const [openRow, setOpenRow] = useState(null); // preset whose actions are showing
  const [renaming, setRenaming] = useState(null); // { from, value }
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(null);

  useEffect(() => {
    window.frameflow.themes.list().then(setThemes).catch(() => {});
  }, []);

  // Runs a themes call that returns the new list; errors show in the menu.
  async function run(call) {
    setError(null);
    try {
      const next = await call();
      if (Array.isArray(next)) setThemes(next);
      return true;
    } catch (err) {
      setError(errorText(err));
      return false;
    }
  }

  function note(text) {
    setFlash(text);
    setTimeout(() => setFlash((f) => (f === text ? null : f)), 1600);
  }

  async function create() {
    const n = name.trim() || `Preset ${themes.length + 1}`;
    if (themes.some((t) => t.name === n)) {
      setError(`“${n}” already exists. Use Update in its settings to overwrite it.`);
      return;
    }
    const { style, canvas } = presetFromProject(project);
    if (await run(() => window.frameflow.themes.save(n, style, canvas))) {
      setName('');
      note(`Saved “${n}”`);
    }
  }

  async function update(t) {
    const { style, canvas } = presetFromProject(project);
    if (await run(() => window.frameflow.themes.save(t.name, style, canvas))) {
      setOpenRow(null);
      note(`Updated “${t.name}”`);
    }
  }

  async function rename() {
    const { from, value } = renaming;
    if (!value.trim() || value.trim() === from) {
      setRenaming(null);
      return;
    }
    if (await run(() => window.frameflow.themes.rename(from, value.trim()))) {
      setRenaming(null);
      setOpenRow(value.trim());
    }
  }

  return (
    <Menu
      align="right"
      width={360}
      trigger={({ open, toggle }) => (
        <button
          onClick={toggle}
          className={`h-8 pl-2.5 pr-2 rounded-[5px] flex items-center gap-1.5 text-[12.5px] border transition-colors ${
            open ? 'bg-slate-800 border-slate-600 text-white' : 'border-slate-700 text-slate-200 hover:bg-slate-800'
          }`}
        >
          <BookmarkIcon size={14} />
          Presets
          <ChevronDownIcon size={14} className="text-slate-500" />
        </button>
      )}
    >
      {(close) => (
        <div className="p-1.5 space-y-2.5">
          {themes.length === 0 ? (
            <p className="px-1.5 pt-1 text-[12px] text-slate-400 leading-snug">
              No presets yet. Set up a look (background, frame, cursor, camera, canvas size), then name it below.
            </p>
          ) : (
            <div className="space-y-0.5">
              {themes.map((t, i) => {
                const matches = presetMatches(t, project);
                const expanded = openRow === t.name;
                return (
                  <div key={t.name} className={`rounded-[6px] ${expanded ? 'bg-slate-800/70' : ''}`}>
                    <div className="group flex items-center gap-1">
                      {renaming?.from === t.name ? (
                        <form
                          className="flex-1 flex gap-1.5 p-1"
                          onSubmit={(e) => {
                            e.preventDefault();
                            rename();
                          }}
                        >
                          <input
                            autoFocus
                            value={renaming.value}
                            onChange={(e) => setRenaming({ from: t.name, value: e.target.value.slice(0, 60) })}
                            onKeyDown={(e) => {
                              if (e.key !== 'Escape') return;
                              e.stopPropagation(); // cancel the rename, keep the menu open
                              setRenaming(null);
                            }}
                            className={INPUT}
                          />
                          <button type="submit" className="h-8 px-3 rounded-[5px] bg-indigo-600 hover:bg-indigo-500 text-white text-[12px]">
                            Rename
                          </button>
                        </form>
                      ) : (
                        <button
                          onClick={() => {
                            applyPreset(t, FRAME_RESET);
                            close();
                          }}
                          title="Click to apply"
                          className="flex-1 min-w-0 h-10 px-3 rounded-[6px] flex items-center gap-2 text-left hover:bg-slate-800"
                        >
                          <span className="truncate text-[13px] text-slate-100">
                            {i + 1}. {t.name}
                          </span>
                          {matches && (
                            <span className="shrink-0 ml-auto px-2 h-5 inline-flex items-center rounded-full bg-slate-700/80 text-[10.5px] text-slate-300">
                              Matches project
                            </span>
                          )}
                        </button>
                      )}
                      {renaming?.from !== t.name && (
                        <button
                          onClick={() => setOpenRow(expanded ? null : t.name)}
                          title="Preset settings"
                          className={`shrink-0 w-9 h-9 rounded-[6px] flex items-center justify-center hover:bg-slate-700 ${
                            expanded ? 'text-white' : 'text-slate-400 hover:text-slate-100'
                          }`}
                        >
                          <SettingsIcon size={16} />
                        </button>
                      )}
                    </div>
                    {expanded && renaming?.from !== t.name && (
                      <div className="flex flex-wrap gap-1 px-2 pb-2">
                        <RowAction onClick={() => update(t)} title="Replace this preset with the project’s current settings">
                          Update to current
                        </RowAction>
                        <RowAction onClick={() => setRenaming({ from: t.name, value: t.name })}>Rename</RowAction>
                        <RowAction onClick={() => run(() => window.frameflow.themes.exportFile(t.name))} title="Save to a file to share with your team">
                          Share as file…
                        </RowAction>
                        <RowAction
                          danger
                          onClick={async () => {
                            if (await run(() => window.frameflow.themes.remove(t.name))) setOpenRow(null);
                          }}
                        >
                          Delete
                        </RowAction>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="px-1.5">
            <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-500 mb-1.5">Starter looks</div>
            <div className="flex flex-wrap gap-1">
              {BUILT_IN_PRESETS.map((p) => (
                <button
                  key={p.name}
                  onClick={() => {
                    applyPreset(p);
                    close();
                  }}
                  className="h-6 px-2 rounded-full border border-slate-700 text-[11px] text-slate-300 hover:text-white hover:border-slate-500"
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          <p className="px-1.5 text-[11px] leading-snug text-slate-500">
            Presets don’t update by themselves. If you apply one and then change the project, use{' '}
            <span className="text-slate-400">Update to current</span> in its settings to keep it in step.
          </p>

          <form
            className="flex gap-1.5 px-0.5"
            onSubmit={(e) => {
              e.preventDefault();
              create();
            }}
          >
            <input
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 60))}
              placeholder="New preset name…"
              className={INPUT}
            />
            <button type="submit" className="h-8 px-3 rounded-[5px] bg-indigo-600 hover:bg-indigo-500 text-white text-[12px] font-medium whitespace-nowrap">
              Create new preset
            </button>
          </form>

          <div className="flex items-center justify-between px-1.5 pb-0.5">
            <button
              onClick={() => run(() => window.frameflow.themes.importFile())}
              className="text-[11px] text-indigo-400 hover:text-indigo-300"
            >
              Import from file…
            </button>
            {flash && <span className="text-[11px] text-emerald-400">{flash}</span>}
          </div>
          {error && <p className="px-1.5 text-[11px] text-amber-400">{error}</p>}
        </div>
      )}
    </Menu>
  );
}

function RowAction({ children, onClick, title, danger }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`h-7 px-2.5 rounded-[5px] text-[11.5px] border ${
        danger
          ? 'border-red-500/40 text-red-400 hover:bg-red-600/15'
          : 'border-slate-600 text-slate-200 hover:bg-slate-700'
      }`}
    >
      {children}
    </button>
  );
}
