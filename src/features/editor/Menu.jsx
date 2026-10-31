import React, { useEffect, useRef, useState } from 'react';
import { CheckIcon } from '../../ui/icons.jsx';

// Dropdown: a trigger button plus a panel that closes on outside click or
// Escape. `children` may be a function receiving close().
export default function Menu({ trigger, children, align = 'left', placement = 'below', width = 220, className = '' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const close = () => setOpen(false);
  return (
    <div ref={ref} className={`relative ${className}`}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div
          className={`absolute z-50 rounded-[7px] border border-black/70 bg-slate-900 p-1 text-[12.5px] text-slate-200 shadow-[0_14px_36px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.05)] ${
            align === 'right' ? 'right-0' : align === 'center' ? 'left-1/2 -translate-x-1/2' : 'left-0'
          } ${placement === 'above' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'}`}
          style={{ width }}
        >
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ children, icon, hint, checked, onClick, disabled, danger }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`group w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-[4px] text-left disabled:opacity-40 disabled:pointer-events-none ${
        danger ? 'text-red-400 hover:bg-red-600 hover:text-white' : 'text-slate-200 hover:bg-indigo-600 hover:text-white'
      }`}
    >
      {icon && <span className="w-4 flex justify-center text-slate-400 group-hover:text-white shrink-0">{icon}</span>}
      <span className="flex-1 truncate">{children}</span>
      {hint && <span className="text-[11px] text-slate-500 group-hover:text-indigo-100">{hint}</span>}
      {checked && <CheckIcon size={14} className="text-indigo-400 group-hover:text-white shrink-0" />}
    </button>
  );
}

export function MenuLabel({ children }) {
  return (
    <div className="px-2.5 pt-2 pb-1 text-[10px] font-medium uppercase tracking-[0.08em] text-slate-500">
      {children}
    </div>
  );
}

export function MenuDivider() {
  return <div className="h-px bg-black/50 my-1 mx-1 shadow-[0_1px_0_rgba(255,255,255,0.04)]" />;
}
