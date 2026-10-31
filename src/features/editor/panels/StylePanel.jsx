import React, { useEffect, useState } from 'react';
import { useEditorStore } from '../../../stores/editor-store.js';
import {
  BACKGROUNDS, WALLPAPERS, WALLPAPER_CATEGORIES, paintWallpaper, enhanceSettings,
} from '../../../engine/composition-engine.js';
import { ShuffleIcon, StarIcon, UploadIcon } from '../../../ui/icons.jsx';
import {
  Button, ColorField, Hint, LinkButton, PercentField, Section, Segmented, Slider, Swatch, Tabs, Toggle,
} from './controls.jsx';

// Background, frame, padding and crop.

const SOURCE_TABS = [
  { id: 'wallpaper', label: 'Wallpaper' },
  { id: 'image', label: 'Image' },
  { id: 'video', label: 'Video' },
  { id: 'color', label: 'Color' },
  { id: 'gradient', label: 'Gradient' },
];

const COLORS = [
  '#1b1b1b', '#2a2a2a', '#3d3d3d', '#6e6e6e', '#d0d0d0', '#f4f4f4',
  '#0b2a52', '#1473e6', '#0f766e', '#15803d', '#b45309', '#b91c1c',
];

const DEFAULT_GRADIENT = { from: '#1473e6', to: '#0b2a52', angle: 135 };

// Device frames: a small outline per model for the picker.
const DEVICE_OPTIONS = [
  { id: 'none', label: 'None', box: null },
  { id: 'browser', label: 'Browser', box: 'w-9 h-6 rounded-[3px] border-t-[5px]' },
  { id: 'laptop', label: 'Laptop', box: 'w-8 h-5 rounded-t-[3px] border-b-0 shadow-[0_3px_0_-1px_currentColor]' },
  { id: 'tablet', label: 'Tablet', box: 'w-6 h-8 rounded-[4px] border-[3px]' },
  { id: 'phone', label: 'Phone', box: 'w-4 h-8 rounded-[5px] border-[3px]' },
];

// Which tab a stored background belongs to.
function sourceKind(background) {
  if (background === 'image' || background === 'video' || background === 'color' || background === 'gradient') {
    return background;
  }
  if (WALLPAPERS.some((w) => w.id === background)) return 'wallpaper';
  if (background?.startsWith('gradient-')) return 'gradient';
  return 'color';
}

// Swatches are rendered by the same painter as the preview and export, once
// per wallpaper per session.
const THUMB_PX = 120;
const thumbCache = new Map();
function wallpaperThumb(wp) {
  if (!thumbCache.has(wp.id)) {
    const c = document.createElement('canvas');
    c.width = THUMB_PX;
    c.height = THUMB_PX;
    paintWallpaper(c.getContext('2d'), THUMB_PX, THUMB_PX, wp);
    thumbCache.set(wp.id, c.toDataURL('image/png'));
  }
  return thumbCache.get(wp.id);
}

// Favourite wallpapers are a per-machine convenience, not project data.
const FAVORITES_KEY = 'frameflow.wallpaperFavorites';
function loadFavorites() {
  try {
    const ids = JSON.parse(localStorage.getItem(FAVORITES_KEY));
    return Array.isArray(ids) ? ids.filter((id) => WALLPAPERS.some((w) => w.id === id)) : [];
  } catch {
    return [];
  }
}

function presetCss(bg) {
  return bg.stops[0] === bg.stops[1] ? bg.stops[0] : `linear-gradient(135deg, ${bg.stops.join(',')})`;
}

export default function StylePanel() {
  const project = useEditorStore((s) => s.project);
  const setStyle = useEditorStore((s) => s.setStyle);
  const st = project.style;
  const kind = sourceKind(st.background);
  const [tab, setTab] = useState(kind);
  const [advancedShadow, setAdvancedShadow] = useState(false);
  const [advancedPadding, setAdvancedPadding] = useState(st.paddingY != null && st.paddingY !== st.padding);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  // Undo/redo or presets can change the source under us.
  useEffect(() => setTab(kind), [kind]);

  const shadow = st.shadowStyle || {};
  const setShadow = (patch, o) => setStyle({ shadowStyle: { ...shadow, ...patch } }, o);
  const inset = st.inset || {};
  const crop = st.crop || { l: 0, r: 0, t: 0, b: 0 };
  const gradient = { ...DEFAULT_GRADIENT, ...st.backgroundGradient };
  const blurrable = kind === 'wallpaper' || kind === 'image' || kind === 'video';

  async function pick(which) {
    setBusy(which);
    setError(null);
    try {
      if (which === 'image') {
        const rel = await window.frameflow.projects.chooseBackground(project.id);
        if (rel) setStyle({ background: 'image', backgroundImage: rel });
      } else {
        const rel = await window.frameflow.projects.chooseBackgroundVideo(project.id);
        if (rel) setStyle({ background: 'video', backgroundVideo: rel });
      }
    } catch (err) {
      setError(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Section
        title="Background"
        action={<LinkButton onClick={() => setStyle({ background: 'wall-steel', backgroundBlur: 0 })}>Reset</LinkButton>}
      >
        <Slider
          label="Blur"
          value={st.backgroundBlur || 0}
          min={0}
          max={1}
          step={0.02}
          disabled={!blurrable}
          format={(v) => (v === 0 ? 'Off' : `${Math.round(v * 100)}%`)}
          onChange={(v, o) => setStyle({ backgroundBlur: v }, o)}
        />
        <Tabs options={SOURCE_TABS} value={tab} onChange={setTab} />

        {tab === 'wallpaper' && (
          <WallpaperPicker value={st.background} onChange={(id) => setStyle({ background: id })} />
        )}

        {tab === 'image' && (
          <>
            <Button onClick={() => pick('image')} disabled={busy === 'image'} className="w-full">
              <UploadIcon size={14} /> {busy === 'image' ? 'Choosing…' : 'Upload image…'}
            </Button>
            {st.backgroundImage && (
              <MediaRow
                label={st.backgroundImage.split('/').pop()}
                active={st.background === 'image'}
                onUse={() => setStyle({ background: 'image' })}
              />
            )}
            <Hint>PNG, JPG or WebP up to 30 MB. The image is copied into the project.</Hint>
          </>
        )}

        {tab === 'video' && (
          <>
            <Button onClick={() => pick('video')} disabled={busy === 'video'} className="w-full">
              <UploadIcon size={14} /> {busy === 'video' ? 'Choosing…' : 'Upload video…'}
            </Button>
            {st.backgroundVideo && (
              <MediaRow
                label={st.backgroundVideo.split('/').pop()}
                active={st.background === 'video'}
                onUse={() => setStyle({ background: 'video' })}
              />
            )}
            <Hint>MP4, WebM or MOV up to 300 MB. It loops silently behind your recording.</Hint>
          </>
        )}

        {tab === 'color' && (
          <>
            <div className="grid grid-cols-6 gap-2">
              {COLORS.map((c) => (
                <Swatch
                  key={c}
                  title={c}
                  selected={st.background === 'color' && st.backgroundColor === c}
                  onClick={() => setStyle({ background: 'color', backgroundColor: c })}
                  style={{ background: c }}
                />
              ))}
            </div>
            <ColorField
              label="Custom color"
              value={st.backgroundColor || '#2a2a2a'}
              onChange={(c, o) => setStyle({ background: 'color', backgroundColor: c }, o)}
            />
          </>
        )}

        {tab === 'gradient' && (
          <>
            <div className="grid grid-cols-7 gap-1.5">
              {BACKGROUNDS.filter((b) => b.id.startsWith('gradient-')).map((bg) => (
                <Swatch
                  key={bg.id}
                  title={bg.label}
                  selected={st.background === bg.id}
                  onClick={() => setStyle({ background: bg.id })}
                  style={{ background: presetCss(bg) }}
                />
              ))}
            </div>
            <div className="rounded-[6px] border border-slate-700 p-2.5 space-y-2.5">
              <div
                className={`h-8 rounded-[4px] cursor-pointer ring-offset-2 ring-offset-slate-900 ${
                  st.background === 'gradient' ? 'ring-2 ring-indigo-500' : ''
                }`}
                onClick={() => setStyle({ background: 'gradient', backgroundGradient: gradient })}
                title="Use this custom gradient"
                style={{ background: `linear-gradient(${gradient.angle}deg, ${gradient.from}, ${gradient.to})` }}
              />
              <ColorField
                label="From"
                value={gradient.from}
                onChange={(c, o) => setStyle({ background: 'gradient', backgroundGradient: { ...gradient, from: c } }, o)}
              />
              <ColorField
                label="To"
                value={gradient.to}
                onChange={(c, o) => setStyle({ background: 'gradient', backgroundGradient: { ...gradient, to: c } }, o)}
              />
              <Slider
                label="Angle"
                value={gradient.angle}
                min={0}
                max={355}
                step={5}
                format={(v) => `${v}°`}
                onChange={(v, o) => setStyle({ background: 'gradient', backgroundGradient: { ...gradient, angle: v } }, o)}
              />
            </div>
          </>
        )}
        {error && <Hint tone="warn">{error}</Hint>}
      </Section>

      <Section
        title="Frame"
        action={
          <LinkButton
            onClick={() =>
              setStyle({ shadow: true, shadowStyle: {}, cornerRadius: 18, inset: { size: 0 } })
            }
          >
            Reset
          </LinkButton>
        }
      >
        <Toggle label="Shadow" checked={st.shadow} onChange={(v) => setStyle({ shadow: v })} />
        {st.shadow && (
          <>
            <Slider
              label="Shadow strength"
              value={shadow.opacity ?? 0.55}
              min={0}
              max={1}
              step={0.05}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(v, o) => setShadow({ opacity: v }, o)}
            />
            <LinkButton onClick={() => setAdvancedShadow((a) => !a)}>
              {advancedShadow ? 'Fewer shadow options' : 'More shadow options'}
            </LinkButton>
            {advancedShadow && (
              <div className="pl-3 border-l border-slate-700 space-y-3">
                <Slider
                  label="Angle"
                  value={shadow.angle ?? 90}
                  min={0}
                  max={355}
                  step={5}
                  format={(v) => `${v}°`}
                  onChange={(v, o) => setShadow({ angle: v }, o)}
                />
                <Slider
                  label="Distance"
                  value={shadow.distance ?? 0.018}
                  min={0}
                  max={0.06}
                  step={0.002}
                  format={(v) => `${Math.round(v * 1000) / 10}%`}
                  onChange={(v, o) => setShadow({ distance: v }, o)}
                />
                <Slider
                  label="Softness"
                  value={shadow.blur ?? 0.045}
                  min={0}
                  max={0.1}
                  step={0.005}
                  format={(v) => `${Math.round(v * 1000) / 10}%`}
                  onChange={(v, o) => setShadow({ blur: v }, o)}
                />
              </div>
            )}
          </>
        )}
        <Slider
          label="Corner radius"
          value={st.cornerRadius}
          min={0}
          max={48}
          step={1}
          format={(v) => `${v}px`}
          onChange={(v, o) => setStyle({ cornerRadius: v }, o)}
        />
        <Slider
          label="Bezel"
          value={inset.size ?? 0}
          min={0}
          max={0.04}
          step={0.002}
          format={(v) => (v === 0 ? 'Off' : `${Math.round(v * 1000) / 10}%`)}
          onChange={(v, o) => setStyle({ inset: { ...inset, size: v } }, o)}
        />
        {inset.size > 0 && (
          <Segmented
            options={[
              { id: 'light', label: 'Light' },
              { id: 'dark', label: 'Dark' },
              { id: 'glass', label: 'Glass' },
            ]}
            value={inset.color || 'light'}
            onChange={(id) => setStyle({ inset: { ...inset, color: id } })}
          />
        )}
      </Section>

      <Section title="Device frame">
        <div className="grid grid-cols-5 gap-1.5">
          {DEVICE_OPTIONS.map((d) => {
            const active = (st.device || 'none') === d.id;
            return (
              <button
                key={d.id}
                onClick={() => setStyle({ device: d.id })}
                title={d.label}
                className={`h-14 rounded-[6px] border flex flex-col items-center justify-center gap-1.5 ${
                  active ? 'border-indigo-500 bg-indigo-500/10 text-indigo-200' : 'border-slate-700 bg-slate-950 text-slate-400 hover:border-slate-500'
                }`}
              >
                {d.box ? <span className={`block border-2 border-current ${d.box}`} /> : <span className="text-[16px] leading-none">∅</span>}
                <span className="text-[10px]">{d.label}</span>
              </button>
            );
          })}
        </div>
        {st.frameless && (st.device || 'none') !== 'none' && <Hint tone="warn">Edge to edge hides the device frame.</Hint>}
        <Hint>Wraps the recording in a device, sized to fit. Great for phone recordings and app demos.</Hint>
      </Section>

      <Section title="Enhance">
        <Slider
          label="Sharpen zoomed video"
          value={enhanceSettings(st).sharpen}
          min={0}
          max={1}
          step={0.05}
          format={(v) => (v === 0 ? 'Off' : `${Math.round(v * 100)}%`)}
          onChange={(v, o) => setStyle({ enhance: { ...enhanceSettings(st), sharpen: v } }, o)}
        />
        <Toggle
          label="Smooth gradient banding"
          checked={enhanceSettings(st).deband}
          onChange={(v) => setStyle({ enhance: { ...enhanceSettings(st), deband: v } })}
        />
        <Hint>Zooms upscale the recording; sharpening restores crisp text as it grows. Debanding keeps backgrounds smooth after compression.</Hint>
      </Section>

      <Section
        title="Padding"
        action={
          <LinkButton
            onClick={() => {
              if (advancedPadding) setStyle({ paddingY: null });
              setAdvancedPadding((a) => !a);
            }}
          >
            {advancedPadding ? 'Simple' : 'Advanced'}
          </LinkButton>
        }
      >
        {advancedPadding ? (
          <>
            <Slider
              label="Horizontal"
              value={st.padding}
              min={0}
              max={0.3}
              step={0.005}
              disabled={st.frameless}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(v, o) => setStyle({ padding: v, paddingY: st.paddingY ?? st.padding }, o)}
            />
            <Slider
              label="Vertical"
              value={st.paddingY ?? st.padding}
              min={0}
              max={0.3}
              step={0.005}
              disabled={st.frameless}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(v, o) => setStyle({ paddingY: v }, o)}
            />
          </>
        ) : (
          <Slider
            label="Padding"
            value={st.padding}
            min={0}
            max={0.3}
            step={0.005}
            disabled={st.frameless}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v, o) => setStyle({ padding: v, paddingY: null }, o)}
          />
        )}
        <Toggle
          label="Remove background"
          hint="The recording fills the frame: no padding, corners or shadow."
          checked={st.frameless}
          onChange={(v) => setStyle({ frameless: v })}
        />
      </Section>

      <Section
        title="Crop"
        action={<LinkButton onClick={() => setStyle({ crop: { l: 0, r: 0, t: 0, b: 0 } })}>Reset</LinkButton>}
      >
        <CropFields crop={crop} onChange={(c) => setStyle({ crop: c })} />
      </Section>
    </>
  );
}

export function CropFields({ crop, onChange }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {[
        ['t', 'Top'],
        ['b', 'Bottom'],
        ['l', 'Left'],
        ['r', 'Right'],
      ].map(([key, label]) => (
        <PercentField key={key} label={label} value={crop[key] || 0} onChange={(v) => onChange({ ...crop, [key]: v })} />
      ))}
    </div>
  );
}

function WallpaperPicker({ value, onChange }) {
  const current = WALLPAPERS.find((w) => w.id === value);
  const [category, setCategory] = useState(current?.category || WALLPAPER_CATEGORIES[0].id);
  const [favorites, setFavorites] = useState(loadFavorites);

  const shown =
    category === 'favorites'
      ? WALLPAPERS.filter((w) => favorites.includes(w.id))
      : WALLPAPERS.filter((w) => w.category === category);

  function toggleFavorite(id) {
    const next = favorites.includes(id) ? favorites.filter((f) => f !== id) : [...favorites, id];
    setFavorites(next);
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
    } catch {
      // Storage can be unavailable; favourites then last for this session.
    }
  }

  // Random from the visible set (or everything if it is empty), never the
  // wallpaper already in use.
  function pickRandom() {
    const pool = (shown.length > 1 ? shown : WALLPAPERS).filter((w) => w.id !== value);
    if (pool.length) onChange(pool[Math.floor(Math.random() * pool.length)].id);
  }

  const chip = (selected) =>
    `flex-auto h-7 px-1.5 rounded-[5px] text-[11.5px] whitespace-nowrap border transition-colors ${
      selected
        ? 'bg-slate-700 border-slate-500 text-slate-100'
        : 'border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500'
    }`;

  return (
    <>
      {/* Star + categories share the row exactly, so nothing hides off the edge. */}
      <div className="flex gap-1">
        <button
          onClick={() => setCategory('favorites')}
          className={`${chip(category === 'favorites')} !flex-none w-7 flex items-center justify-center !px-0`}
          title="Favourites"
        >
          <StarIcon size={13} />
        </button>
        {WALLPAPER_CATEGORIES.map((c) => (
          <button key={c.id} onClick={() => setCategory(c.id)} className={chip(category === c.id)}>
            {c.label}
          </button>
        ))}
      </div>
      <Button onClick={pickRandom} className="w-full">
        <ShuffleIcon size={14} /> Pick random wallpaper
      </Button>
      {shown.length === 0 ? (
        <Hint>Star a wallpaper to keep it here.</Hint>
      ) : (
        <div className="grid grid-cols-4 gap-2">
          {shown.map((wp) => {
            const fav = favorites.includes(wp.id);
            return (
              <div key={wp.id} className="relative group">
                <Swatch
                  title={wp.label}
                  selected={value === wp.id}
                  onClick={() => onChange(wp.id)}
                  style={{ backgroundImage: `url(${wallpaperThumb(wp)})`, backgroundSize: 'cover', width: '100%' }}
                />
                <button
                  onClick={() => toggleFavorite(wp.id)}
                  title={fav ? 'Remove from favourites' : 'Add to favourites'}
                  className={`absolute top-1 right-1 p-0.5 rounded bg-black/45 transition-opacity ${
                    fav ? 'text-amber-300 opacity-100' : 'text-white opacity-0 group-hover:opacity-100'
                  }`}
                >
                  <StarIcon size={11} className={fav ? 'fill-current' : ''} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function MediaRow({ label, active, onUse }) {
  return (
    <div className="flex items-center gap-2 h-8 px-2.5 rounded-[5px] bg-slate-950 border border-slate-700">
      <span className="flex-1 truncate text-[12px] text-slate-300">{label}</span>
      {active ? (
        <span className="text-[11px] text-indigo-400">In use</span>
      ) : (
        <LinkButton onClick={onUse}>Use</LinkButton>
      )}
    </div>
  );
}
