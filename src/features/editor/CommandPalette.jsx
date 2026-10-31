import React, { useEffect, useMemo, useRef, useState } from 'react';

// Ctrl+K command menu: type to filter, arrows to move, Enter to run.
// `commands`: [{ id, label, hint?, run }].
export default function CommandPalette({ commands, onClose }) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    const words = q.split(/\s+/);
    return commands.filter((c) => {
      const text = `${c.label} ${c.hint || ''}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
  }, [commands, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  function run(cmd) {
    onClose();
    // Let the palette unmount first so commands that open dialogs get focus.
    setTimeout(() => cmd.run(), 0);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => Math.min(matches.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter' && matches[index]) {
      e.preventDefault();
      run(matches[index]);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center pt-[15vh] z-50" onMouseDown={onClose}>
      <div
        className="bg-slate-900 border border-slate-700 rounded-xl w-[30rem] shadow-2xl overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Type a command…"
          className="w-full bg-transparent border-b border-slate-700 px-4 py-3 text-sm text-slate-100 outline-none"
        />
        <div className="max-h-80 overflow-y-auto py-1">
          {matches.length === 0 && <p className="px-4 py-3 text-xs text-slate-500">No matching commands</p>}
          {matches.map((c, i) => (
            <button
              key={c.id}
              onMouseEnter={() => setIndex(i)}
              onClick={() => run(c)}
              className={`w-full flex items-center justify-between px-4 py-2 text-left text-sm ${
                i === index ? 'bg-indigo-600/30 text-white' : 'text-slate-300'
              }`}
            >
              <span>{c.label}</span>
              {c.hint && <span className="text-[11px] text-slate-500">{c.hint}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
