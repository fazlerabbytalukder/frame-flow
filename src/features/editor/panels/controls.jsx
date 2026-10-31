import React from 'react';

// Form controls for the editor's side panels (graphite theme, blue accent).
// Sliders report every step as transient and commit once on release, so a
// whole drag is one undo step: onChange(value, { transient }).

export function Section({ title, action, children }) {
  return (
    <section className="px-4 py-3.5 border-b border-black/40">
      <header className="flex items-center justify-between min-h-5 mb-2.5">
        <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-slate-400">{title}</h3>
        {action}
      </header>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export function LinkButton({ children, onClick, title }) {
  return (
    <button onClick={onClick} title={title} className="text-[11px] text-indigo-400 hover:text-indigo-300">
      {children}
    </button>
  );
}

export function Slider({ label, value, min, max, step, onChange, format, disabled }) {
  const pct = ((value - min) / (max - min)) * 100;
  const commit = (e) => onChange(Number(e.target.value));
  return (
    <div className={disabled ? 'opacity-40 pointer-events-none' : ''}>
      <div className="flex justify-between text-[12px] mb-1">
        <span className="text-slate-300">{label}</span>
        <span className="text-slate-400 tabular-nums">{format ? format(value) : value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value), { transient: true })}
        onPointerUp={commit}
        onKeyUp={commit}
        className="ff-range w-full"
        style={{ '--fill': `${Math.min(100, Math.max(0, pct))}%` }}
      />
    </div>
  );
}

export function Toggle({ label, hint, checked, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="w-full flex items-center gap-3 text-left group"
    >
      <span className="flex-1 min-w-0">
        <span className="block text-[12.5px] text-slate-200 group-hover:text-white">{label}</span>
        {hint && <span className="block text-[11px] text-slate-500 leading-snug">{hint}</span>}
      </span>
      <Switch on={Boolean(checked)} />
    </button>
  );
}

export function Switch({ on }) {
  return (
    <span className={`shrink-0 w-[30px] h-4 rounded-full p-0.5 transition-colors ${on ? 'bg-indigo-500' : 'bg-slate-600'}`}>
      <span className={`block w-3 h-3 rounded-full bg-white transition-transform ${on ? 'translate-x-[14px]' : ''}`} />
    </span>
  );
}

// Underlined tabs (used for the background source).
export function Tabs({ options, value, onChange }) {
  return (
    // Tabs size to their labels so five fit in the side panel.
    <div className="flex border-b border-slate-700">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`flex-auto min-w-0 px-1 -mb-px pb-1.5 pt-0.5 text-[11.5px] whitespace-nowrap border-b-2 transition-colors ${
            value === o.id
              ? 'border-indigo-500 text-slate-100'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Segmented({ options, value, onChange }) {
  return (
    <div
      className="grid gap-px p-px rounded-[5px] bg-black/40 border border-slate-700"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          title={o.hint}
          className={`rounded-[4px] py-1.5 text-[11.5px] transition-colors ${
            value === o.id ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Label({ children }) {
  return <div className="text-[11.5px] text-slate-400 mb-1.5">{children}</div>;
}

export function Hint({ children, tone }) {
  return (
    <p className={`text-[11px] leading-snug ${tone === 'warn' ? 'text-amber-400/90' : 'text-slate-500'}`}>{children}</p>
  );
}

export function Button({ children, onClick, disabled, tone = 'default', title, className = '' }) {
  const tones = {
    default: 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700',
    primary: 'bg-indigo-600 hover:bg-indigo-500 text-white',
    danger: 'bg-transparent hover:bg-red-600/15 text-red-400 border border-red-500/40',
    ghost: 'text-slate-300 hover:bg-slate-800',
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`h-7 px-3 rounded-[5px] text-[12px] font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none inline-flex items-center justify-center gap-1.5 ${tones[tone]} ${className}`}
    >
      {children}
    </button>
  );
}

// Swatch grid button for backgrounds and colors.
export function Swatch({ selected, onClick, title, style, children }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={style}
      className={`aspect-square rounded-[5px] overflow-hidden ring-offset-2 ring-offset-slate-900 transition-shadow ${
        selected ? 'ring-2 ring-indigo-500' : 'ring-1 ring-black/40 hover:ring-slate-500'
      }`}
    >
      {children}
    </button>
  );
}

// Native color input behind a swatch-styled button. Picking is transient;
// closing the picker (blur) commits one undo step.
export function ColorField({ label, value, onChange }) {
  return (
    <label className="flex items-center gap-2.5 cursor-pointer">
      <span className="relative w-7 h-7 rounded-[5px] ring-1 ring-black/50 overflow-hidden" style={{ background: value }}>
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value, { transient: true })}
          onBlur={(e) => onChange(e.target.value)}
          className="absolute inset-0 opacity-0 cursor-pointer"
        />
      </span>
      <span className="text-[12px] text-slate-300 flex-1">{label}</span>
      <span className="text-[11px] font-mono text-slate-500 uppercase">{value}</span>
    </label>
  );
}

// Percent input for exact values (crop edges).
export function PercentField({ label, value, onChange, max = 85 }) {
  return (
    <label className="flex items-center justify-between gap-2 h-8 px-2.5 rounded-[5px] bg-slate-950 border border-slate-700 focus-within:border-indigo-500">
      <span className="text-[12px] text-slate-400">{label}</span>
      <span className="flex items-center gap-0.5">
        <input
          type="number"
          min={0}
          max={max}
          step={1}
          value={Math.round(value * 100)}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) onChange(Math.min(max, Math.max(0, v)) / 100);
          }}
          className="w-10 bg-transparent text-right text-[12px] text-slate-100 tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
        />
        <span className="text-[11px] text-slate-500">%</span>
      </span>
    </label>
  );
}

export function SelectionCard({ title, onDone, onDelete, deleteLabel = 'Delete', children }) {
  return (
    <div className="rounded-[6px] border border-indigo-500/40 bg-indigo-500/5 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold text-slate-100">{title}</span>
        <LinkButton onClick={onDone}>Done</LinkButton>
      </div>
      {children}
      {onDelete && (
        <Button tone="danger" onClick={onDelete} className="w-full">
          {deleteLabel}
        </Button>
      )}
    </div>
  );
}
