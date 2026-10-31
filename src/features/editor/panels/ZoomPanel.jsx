import React from 'react';
import { useEditorStore } from '../../../stores/editor-store.js';
import { PlusIcon, WandIcon } from '../../../ui/icons.jsx';
import { zoomStyleOf } from '../../../engine/zoom-engine.js';
import { useEditorActions } from '../editor-context.js';
import { Button, Hint, Section, Segmented, Toggle } from './controls.jsx';
import { ItemList } from './ItemList.jsx';

// Zoom style, auto zoom and the list of zoom blocks.

export default function ZoomPanel() {
  const project = useEditorStore((s) => s.project);
  const cursorTrack = useEditorStore((s) => s.cursorTrack);
  const selectedZoomId = useEditorStore((s) => s.selectedZoomId);
  const selectZoom = useEditorStore((s) => s.selectZoom);
  const setZoomStyle = useEditorStore((s) => s.setZoomStyle);
  const setStyle = useEditorStore((s) => s.setStyle);
  const actions = useEditorActions();
  const hasCursorData = cursorTrack?.samples?.length > 0 || cursorTrack?.clicks?.length > 0;
  const autoCount = project.zoomEvents.filter((z) => z.auto).length;
  const zoomStyle = zoomStyleOf(project.style);

  return (
    <>
      <Section title="Zoom style">
        <Segmented
          options={[
            { id: 'classic', label: 'Classic zoom' },
            { id: 'loupe', label: 'Loupe zoom' },
          ]}
          value={zoomStyle}
          onChange={(id) => id !== zoomStyle && setZoomStyle(id)}
        />
        <Hint>
          {zoomStyle === 'classic'
            ? 'The whole frame zooms in on the focus point.'
            : 'A magnifying lens opens over the focus point; the rest of the frame stays put.'}{' '}
          Switching converts every zoom; you can still change one zoom on its own.
        </Hint>
        <Toggle
          label="Smart framing"
          hint="While zoomed, the frame shifts so your camera never covers the cursor."
          checked={project.style.smartFraming !== false}
          onChange={(v) => setStyle({ smartFraming: v })}
        />
      </Section>

      <Section title="Auto zoom">
        <p className="text-[12px] text-slate-300 leading-snug">
          Zooms in on the places you clicked and follows the cursor, then eases back out.
        </p>
        <div className="flex gap-2">
          <Button tone="primary" className="flex-1" onClick={actions.runAutoZoom} disabled={!hasCursorData}>
            <WandIcon size={14} /> {autoCount ? 'Redo auto zoom' : 'Auto zoom'}
          </Button>
          <Button onClick={actions.addZoomAtPlayhead} title="Add a zoom at the playhead">
            <PlusIcon size={14} /> Zoom
          </Button>
        </div>
        {hasCursorData ? (
          <Hint>
            {autoCount
              ? `${autoCount} automatic zoom${autoCount === 1 ? '' : 's'}. Redoing replaces only those; zooms you added or moved by hand stay.`
              : 'New recordings get auto zooms when they first open.'}
          </Hint>
        ) : (
          <Hint>This recording has no click or cursor data, so zooms must be added by hand.</Hint>
        )}
      </Section>

      <Section title={`Zooms (${project.zoomEvents.length})`}>
        <ItemList
          items={project.zoomEvents}
          selectedId={selectedZoomId}
          empty="No zooms yet."
          label={(z) => `${z.type === 'loupe' ? 'Loupe' : 'Zoom'} ${z.scale.toFixed(1)}×${z.auto ? ' · auto' : ''}`}
          onPick={(z) => {
            selectZoom(z.id);
            actions.seek(z.time);
          }}
        />
        <Hint>Select a zoom, then click the preview to set where it focuses.</Hint>
      </Section>
    </>
  );
}
