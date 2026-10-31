import React, { useState } from 'react';
import {
  CameraIcon, CaptionsIcon, PointerIcon, SettingsIcon, ShapesIcon, SparklesIcon, SpeakerIcon, TranscriptIcon, TransitionIcon, ZoomInIcon,
} from '../../ui/icons.jsx';
import StylePanel from './panels/StylePanel.jsx';
import CursorPanel from './panels/CursorPanel.jsx';
import ZoomPanel from './panels/ZoomPanel.jsx';
import CameraPanel from './panels/CameraPanel.jsx';
import CaptionsPanel from './panels/CaptionsPanel.jsx';
import TranscriptPanel from './panels/TranscriptPanel.jsx';
import AnnotatePanel from './panels/AnnotatePanel.jsx';
import AudioPanel from './panels/AudioPanel.jsx';
import SettingsPanel from './panels/SettingsPanel.jsx';
import TransitionsPanel from './panels/TransitionsPanel.jsx';
import SelectionPanel from './panels/SelectionPanel.jsx';

// Left side of the editor: an icon rail picks the section shown in the docked
// panel. A timeline selection's editor is pinned to the top of the panel.

const SECTIONS = [
  { id: 'style', label: 'Style', icon: SparklesIcon, Panel: StylePanel },
  { id: 'cursor', label: 'Cursor', icon: PointerIcon, Panel: CursorPanel },
  { id: 'zoom', label: 'Zoom', icon: ZoomInIcon, Panel: ZoomPanel },
  { id: 'camera', label: 'Camera', icon: CameraIcon, Panel: CameraPanel },
  { id: 'transitions', label: 'Transitions', icon: TransitionIcon, Panel: TransitionsPanel },
  { id: 'transcript', label: 'Transcript', icon: TranscriptIcon, Panel: TranscriptPanel },
  { id: 'captions', label: 'Captions', icon: CaptionsIcon, Panel: CaptionsPanel },
  { id: 'annotate', label: 'Annotate', icon: ShapesIcon, Panel: AnnotatePanel },
  { id: 'audio', label: 'Audio', icon: SpeakerIcon, Panel: AudioPanel },
  { id: 'settings', label: 'Settings', icon: SettingsIcon, Panel: SettingsPanel },
];

const SECTION_KEY = 'frameflow.editor.section';

function initialSection() {
  try {
    const saved = localStorage.getItem(SECTION_KEY);
    if (SECTIONS.some((s) => s.id === saved)) return saved;
  } catch {
    // Remembering the section is only a convenience.
  }
  return 'style';
}

export default function SidePanel() {
  const [section, setSection] = useState(initialSection);
  const current = SECTIONS.find((s) => s.id === section);

  function pick(id) {
    setSection(id);
    try {
      localStorage.setItem(SECTION_KEY, id);
    } catch {
      // ignore
    }
  }

  return (
    <div className="flex min-h-0 shrink-0">
      <nav className="w-[60px] shrink-0 bg-slate-950 border-r border-black/60 py-2 flex flex-col items-center gap-0.5">
        {SECTIONS.map(({ id, label, icon: Icon }) => {
          const active = id === section;
          return (
            <button
              key={id}
              onClick={() => pick(id)}
              title={label}
              className={`relative w-[52px] py-1.5 rounded-[5px] flex flex-col items-center gap-1 transition-colors ${
                active ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900'
              }`}
            >
              {active && <span className="absolute -left-1 top-2 bottom-2 w-[3px] rounded-r bg-indigo-500" />}
              <Icon size={18} />
              <span className="text-[9.5px] leading-none">{label}</span>
            </button>
          );
        })}
      </nav>
      <aside className="w-[292px] shrink-0 bg-slate-900 border-r border-black/60 flex flex-col min-h-0">
        <header className="h-9 shrink-0 flex items-center px-4 border-b border-black/40 text-[12px] font-semibold text-slate-200">
          {current.label}
        </header>
        <div className="flex-1 overflow-y-auto ff-scroll">
          <SelectionPanel />
          <current.Panel />
        </div>
      </aside>
    </div>
  );
}
