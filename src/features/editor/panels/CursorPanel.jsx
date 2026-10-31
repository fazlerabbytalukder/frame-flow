import React, { useEffect, useRef, useState } from 'react';
import { isAddedClip } from '../../../engine/timeline-engine.js';
import { useEditorStore } from '../../../stores/editor-store.js';
import { detectTypingSegments } from '../../../engine/cursor-track.js';
import {
  CLICK_COLORS, CLICK_EFFECTS, CURSOR_FAMILIES, CURSOR_TYPES, cursorSettings, drawCursorShape,
} from '../../../engine/cursor-style.js';
import { Button, ColorField, Hint, Label, LinkButton, Section, Segmented, Slider, Switch, Toggle } from './controls.jsx';

// Cursor look and click effects, camera motion and keyboard shortcuts.

const SCREEN_ANIMATION_OPTIONS = [
  { id: 'focused', label: 'Focused', hint: 'Settles fast, easiest to read' },
  { id: 'smooth', label: 'Smooth', hint: 'Softer, more fluid motion' },
  { id: 'classic', label: 'Classic', hint: 'Fixed ease using each zoom’s transition time' },
];

const CURSOR_ANIMATION_OPTIONS = [
  { id: 'smooth', label: 'Smooth' },
  { id: 'medium', label: 'Medium' },
  { id: 'rapid', label: 'Rapid' },
  { id: 'none', label: 'None' },
];

// Defaults restored by Reset (look and click effects; movement is kept).
const CURSOR_RESET = {
  type: 'classic', size: 1.4, clickEffect: 'ripple', clickColor: '#2680eb', clickSize: 1, clickOpacity: 0.9,
  clickDuration: 550, bounce: 0.5, bounceSpeed: 350, sway: 0.25, rotate: false, clickHighlights: true,
};

export default function CursorPanel() {
  const project = useEditorStore((s) => s.project);
  const cursorTrack = useEditorStore((s) => s.cursorTrack);
  const setStyle = useEditorStore((s) => s.setStyle);
  const speedUpSegments = useEditorStore((s) => s.speedUpSegments);
  const [typingSpeed, setTypingSpeed] = useState(3);
  const [moreCursor, setMoreCursor] = useState(false);
  const [advancedClicks, setAdvancedClicks] = useState(false);

  const cursor = project.style.cursor || {};
  const look = cursorSettings(cursor);
  const setCursor = (patch, o) => setStyle({ cursor: { ...cursor, ...patch } }, o);
  const animation = project.style.animation || { screen: 'classic', motionBlur: { strength: 0 } };
  const motionBlur = animation.motionBlur || { strength: 0 };
  const setBlur = (patch, o) => setStyle({ animation: { ...animation, motionBlur: { ...motionBlur, ...patch } } }, o);
  const hasClicks = cursorTrack?.clicks?.length > 0;
  const baked = !project.recording?.cursorHidden;
  // Typing stretches only map onto clips that still contain them at 1x.
  const typingSegments = detectTypingSegments(cursorTrack?.typing).filter((s) =>
    project.clips.some((c) => !isAddedClip(c) && c.start < s.end && c.start + c.duration > s.start && (c.speed || 1) === 1)
  );

  return (
    <>
      <Section
        title="Cursor"
        action={<LinkButton onClick={() => setCursor(CURSOR_RESET)}>Reset</LinkButton>}
      >
        <div className="grid grid-cols-2 gap-2">
          <MiniToggle label="Show cursor" on={Boolean(cursor.overlay)} onChange={(v) => setCursor({ overlay: v })} />
          <MiniToggle label="Loop cursor" on={Boolean(cursor.loop)} onChange={(v) => setCursor({ loop: v })} />
        </div>
        {cursor.loop && cursor.overlay && (
          <Slider
            label="Glide back over"
            value={look.loopDuration}
            min={0.3}
            max={3}
            step={0.1}
            format={(v) => `${v.toFixed(1)}s`}
            onChange={(v, o) => setCursor({ loopDuration: v }, o)}
          />
        )}
        {baked && (
          <Hint tone={cursor.overlay ? 'warn' : undefined}>
            {cursor.overlay
              ? 'This recording already contains the Windows cursor, so two cursors show. New screen recordings are made without it.'
              : 'This recording contains the Windows cursor. New screen recordings are made without it, so the styles below apply.'}
          </Hint>
        )}
        <CursorStylePicker value={look.type} disabled={!cursor.overlay} onChange={(type) => setCursor({ type })} />
        <Slider
          label="Cursor size"
          value={look.size}
          min={0.5}
          max={3}
          step={0.05}
          disabled={!cursor.overlay}
          format={(v) => `${v.toFixed(2)}×`}
          onChange={(v, o) => setCursor({ size: v }, o)}
        />
        {cursor.overlay && (
          <>
            <LinkButton onClick={() => setMoreCursor((m) => !m)}>
              {moreCursor ? 'Fewer cursor options' : 'More cursor options'}
            </LinkButton>
            {moreCursor && (
              <div className="pl-3 border-l border-slate-700 space-y-3">
                <div>
                  <Label>Movement smoothing</Label>
                  <Segmented
                    options={CURSOR_ANIMATION_OPTIONS}
                    value={cursor.animation || 'medium'}
                    onChange={(id) => setCursor({ animation: id })}
                  />
                </div>
                <Toggle label="Hide when idle" checked={cursor.hideIdle} onChange={(v) => setCursor({ hideIdle: v })} />
                {cursor.hideIdle && (
                  <Slider
                    label="Hide after"
                    value={look.idleDelay}
                    min={0.5}
                    max={5}
                    step={0.1}
                    format={(v) => `${v.toFixed(1)}s still`}
                    onChange={(v, o) => setCursor({ idleDelay: v }, o)}
                  />
                )}
                <Toggle label="Stop moving at the end" checked={cursor.stopAtEnd} onChange={(v) => setCursor({ stopAtEnd: v })} />
                <Toggle label="Remove shakes" checked={cursor.removeShakes} onChange={(v) => setCursor({ removeShakes: v })} />
              </div>
            )}
          </>
        )}
      </Section>

      <Section
        title="Click effects"
        action={
          <LinkButton onClick={() => setAdvancedClicks((a) => !a)}>{advancedClicks ? 'Simple' : 'Advanced'}</LinkButton>
        }
      >
        <div className="grid grid-cols-4 gap-2">
          {CLICK_EFFECTS.map((e) => (
            <button
              key={e.id}
              onClick={() => setCursor({ clickEffect: e.id, clickHighlights: e.id !== 'none' })}
              title={e.label}
              className={`aspect-square rounded-[6px] bg-slate-950 flex items-center justify-center transition-colors ${
                look.clickEffect === e.id ? 'ring-2 ring-indigo-500' : 'ring-1 ring-black/50 hover:ring-slate-500'
              }`}
            >
              <EffectGlyph effect={e.id} color={look.clickColor} />
            </button>
          ))}
        </div>
        {look.clickEffect !== 'none' && (
          <>
            <div>
              <Label>Effect color</Label>
              <div className="flex flex-wrap gap-1.5">
                {CLICK_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setCursor({ clickColor: c })}
                    title={c}
                    className={`w-6 h-6 rounded-full ring-offset-2 ring-offset-slate-900 ${
                      look.clickColor === c ? 'ring-2 ring-indigo-500' : 'ring-1 ring-black/40'
                    }`}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </div>
            <ColorField label="Custom color" value={look.clickColor} onChange={(c, o) => setCursor({ clickColor: c }, o)} />
            <Slider
              label="Effect size"
              value={look.clickSize}
              min={0.4}
              max={2.5}
              step={0.05}
              format={(v) => `${v.toFixed(2)}×`}
              onChange={(v, o) => setCursor({ clickSize: v }, o)}
            />
            {advancedClicks && (
              <>
                <Slider
                  label="Effect opacity"
                  value={look.clickOpacity}
                  min={0.1}
                  max={1}
                  step={0.05}
                  format={(v) => `${Math.round(v * 100)}%`}
                  onChange={(v, o) => setCursor({ clickOpacity: v }, o)}
                />
                <Slider
                  label="Effect duration"
                  value={look.clickDuration}
                  min={200}
                  max={1500}
                  step={50}
                  format={(v) => `${v} ms`}
                  onChange={(v, o) => setCursor({ clickDuration: v }, o)}
                />
              </>
            )}
          </>
        )}
        {!hasClicks && (
          <Hint>No clicks were recorded here. Effects appear on recordings made with the click tracker on.</Hint>
        )}
      </Section>

      <Section title="Click bounce & sway">
        <Slider
          label="Click bounce"
          value={look.bounce}
          min={0}
          max={1}
          step={0.05}
          disabled={!cursor.overlay}
          format={(v) => (v === 0 ? 'Off' : `${Math.round(v * 100)}%`)}
          onChange={(v, o) => setCursor({ bounce: v }, o)}
        />
        <Slider
          label="Bounce speed"
          value={look.bounceSpeed}
          min={150}
          max={900}
          step={25}
          disabled={!cursor.overlay || look.bounce === 0}
          format={(v) => `${v} ms`}
          onChange={(v, o) => setCursor({ bounceSpeed: v }, o)}
        />
        <Slider
          label="Cursor sway"
          value={look.sway}
          min={0}
          max={1}
          step={0.05}
          disabled={!cursor.overlay}
          format={(v) => (v === 0 ? 'Off' : `${Math.round(v * 100)}%`)}
          onChange={(v, o) => setCursor({ sway: v, rotate: v > 0 }, o)}
        />
        <Hint>Bounce squeezes the cursor on each click; sway tilts it in the direction it moves.</Hint>
      </Section>

      <Section title="Motion">
        <div>
          <Label>Camera movement</Label>
          <Segmented
            options={SCREEN_ANIMATION_OPTIONS}
            value={animation.screen || 'classic'}
            onChange={(id) => setStyle({ animation: { ...animation, screen: id } })}
          />
          <div className="mt-1.5">
            <Hint>{SCREEN_ANIMATION_OPTIONS.find((o) => o.id === (animation.screen || 'classic'))?.hint}</Hint>
          </div>
        </div>
        <Slider
          label="Motion blur"
          value={motionBlur.strength || 0}
          min={0}
          max={1}
          step={0.05}
          format={(v) => (v === 0 ? 'Off' : `${Math.round(v * 100)}%`)}
          onChange={(v, o) => setBlur({ strength: v }, o)}
        />
        {motionBlur.strength > 0 && (
          <>
            <Toggle label="Blur cursor movement" checked={motionBlur.cursor !== false} onChange={(v) => setBlur({ cursor: v })} />
            <Toggle label="Blur zooming" checked={motionBlur.zoom !== false} onChange={(v) => setBlur({ zoom: v })} />
            <Toggle label="Blur panning" checked={motionBlur.pan !== false} onChange={(v) => setBlur({ pan: v })} />
          </>
        )}
      </Section>

      <Section title="Keyboard">
        <Toggle
          label="Show pressed shortcuts"
          checked={project.style.shortcuts?.enabled !== false}
          onChange={(v) => setStyle({ shortcuts: { ...project.style.shortcuts, enabled: v } })}
        />
        {!cursorTrack?.shortcuts?.length && (
          <Hint>No shortcuts in this recording. Only Ctrl/Alt/Win combinations are captured, never typed text.</Hint>
        )}
        {typingSegments.length > 0 && (
          <div className="rounded-[6px] border border-slate-700 p-2.5 space-y-2">
            <p className="text-[12px] text-slate-300">
              {typingSegments.length} typing {typingSegments.length === 1 ? 'stretch' : 'stretches'} (
              {typingSegments.reduce((s, x) => s + (x.end - x.start), 0).toFixed(1)}s)
            </p>
            <div className="flex gap-1.5">
              <select
                value={typingSpeed}
                onChange={(e) => setTypingSpeed(Number(e.target.value))}
                className="h-7 bg-slate-950 border border-slate-700 rounded-[5px] px-2 text-[12px] text-slate-100"
              >
                {[1.5, 2, 3, 4].map((s) => (
                  <option key={s} value={s}>
                    {s}×
                  </option>
                ))}
              </select>
              <Button tone="primary" className="flex-1" onClick={() => speedUpSegments(typingSegments, typingSpeed)}>
                Speed up typing
              </Button>
            </div>
          </div>
        )}
      </Section>
    </>
  );
}

function MiniToggle({ label, on, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className="flex items-center justify-between gap-1.5 h-8 pl-2.5 pr-2 rounded-[5px] bg-slate-950 border border-slate-700 hover:border-slate-500"
    >
      <span className="text-[12px] text-slate-200 whitespace-nowrap">{label}</span>
      <Switch on={on} />
    </button>
  );
}

// Preview of a cursor type, drawn from the same path data as the renderer.
// Base styles, one tile per family; picking a family tile shows its
// variants underneath.
function CursorStylePicker({ value, disabled, onChange }) {
  const current = CURSOR_TYPES.find((t) => t.id === value) || CURSOR_TYPES[0];
  const tiles = [
    ...CURSOR_TYPES.filter((t) => !t.family),
    ...CURSOR_FAMILIES.map((f) => {
      const variants = CURSOR_TYPES.filter((t) => t.family === f.id);
      return { ...(current.family === f.id ? current : variants[0]), label: f.label, familyId: f.id };
    }),
  ];
  const variants = current.family ? CURSOR_TYPES.filter((t) => t.family === current.family) : [];
  const tile = (selected) =>
    `rounded-[6px] flex items-center justify-center transition-colors bg-[radial-gradient(circle_at_30%_25%,#4a4a4a,#2a2a2a)] ${
      selected ? 'ring-2 ring-indigo-500' : 'ring-1 ring-black/50 hover:ring-slate-500'
    }`;
  return (
    <div className={`space-y-2.5 ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
      <div className="grid grid-cols-4 gap-2">
        {tiles.map((t) => (
          <button
            key={t.familyId || t.id}
            onClick={() => onChange(t.id)}
            title={t.label}
            className={`aspect-square ${tile(t.familyId ? current.family === t.familyId : value === t.id)}`}
          >
            <CursorGlyph type={t} />
          </button>
        ))}
      </div>
      {variants.length > 0 && (
        <div>
          <Label>Variant</Label>
          <div className="grid grid-cols-4 gap-1.5">
            {variants.map((t) => (
              <button key={t.id} onClick={() => onChange(t.id)} title={t.label} className={`h-10 ${tile(value === t.id)}`}>
                <CursorGlyph type={t} size={24} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Drawn with the renderer itself, so the tile matches the video exactly.
function CursorGlyph({ type, size = 30 }) {
  const ref = useRef(null);
  const height = Math.round(size * 1.14);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Same framing as before: 30 grid units across, hotspot 7 in and 4 down.
    const unit = (size * dpr) / 30;
    ctx.save();
    ctx.translate(7 * unit, 4 * unit);
    if (type.dot) ctx.translate(8 * unit, 10 * unit);
    drawCursorShape(ctx, type.id, 24 * unit);
    ctx.restore();
  }, [type.id, type.dot, size, height]);
  return <canvas ref={ref} style={{ width: size, height }} aria-hidden="true" />;
}

function EffectGlyph({ effect, color }) {
  if (effect === 'none') {
    return (
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-slate-500" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M5.6 5.6l12.8 12.8" />
      </svg>
    );
  }
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {effect === 'ripple' && (
        <>
          <circle cx="12" cy="12" r="10" stroke={color} strokeOpacity="0.45" strokeWidth="1.6" />
          <circle cx="12" cy="12" r="6" stroke={color} strokeWidth="1.8" />
        </>
      )}
      {effect === 'ring' && <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="2" />}
      {effect === 'pulse' && (
        <>
          <circle cx="12" cy="12" r="9.5" fill={color} fillOpacity="0.25" stroke={color} strokeWidth="1.6" />
          <circle cx="12" cy="12" r="3" fill={color} />
        </>
      )}
    </svg>
  );
}
