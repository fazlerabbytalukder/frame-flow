import React from 'react';

// Time-ordered list of timeline items (zooms, captions, annotations).
export function ItemList({ items, selectedId, label, onPick, empty }) {
  if (items.length === 0) return <p className="text-[12px] text-slate-500">{empty}</p>;
  return (
    <div className="rounded-[6px] border border-slate-700 divide-y divide-black/40 overflow-hidden">
      {[...items]
        .sort((a, b) => a.time - b.time)
        .map((item) => (
          <button
            key={item.id}
            onClick={() => onPick(item)}
            className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 text-left text-[12px] ${
              item.id === selectedId ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <span className={`tabular-nums text-[11px] w-10 shrink-0 ${item.id === selectedId ? 'text-indigo-100' : 'text-slate-500'}`}>
              {formatShort(item.time)}
            </span>
            <span className="flex-1 truncate">{label(item)}</span>
          </button>
        ))}
    </div>
  );
}

export function formatShort(t) {
  const m = Math.floor(t / 60);
  return `${m}:${(t % 60).toFixed(1).padStart(4, '0')}`;
}
