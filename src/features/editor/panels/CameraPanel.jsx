import React, { useRef, useState } from 'react';
import { useEditorStore } from '../../../stores/editor-store.js';
import { useEditorActions } from '../editor-context.js';
import { Hint, Label, Section, Segmented, Slider, Toggle } from './controls.jsx';
import { CAMERA_LOOKS, cameraLookFilter } from '../../../engine/composition-engine.js';
import { analyzeFaceTrack } from '../../../engine/person-mask.js';

// Webcam bubble and timed camera layouts.

// Story order: introduce on camera, walk through side by side, keep the
// bubble while clicking, give the screen the room, then step onto the stage.
export const LAYOUT_OPTIONS = [
  { id: 'camera', label: 'Fullscreen camera' },
  { id: 'split', label: 'Split screen' },
  { id: 'overlay', label: 'Camera overlay' },
  { id: 'screen', label: 'Screen only' },
  { id: 'cutout', label: 'Camera cutout' },
];

const POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

const LOOK_LABELS = { natural: 'Natural', warm: 'Warm', cool: 'Cool', film: 'Film', vivid: 'Vivid', soft: 'Soft', mono: 'Mono' };

export default function CameraPanel() {
  const project = useEditorStore((s) => s.project);
  const setStyle = useEditorStore((s) => s.setStyle);
  const updateProject = useEditorStore((s) => s.updateProject);
  const actions = useEditorActions();
  const [detecting, setDetecting] = useState(false);
  const [faceJob, setFaceJob] = useState(null); // { progress } | { error }
  const faceAbort = useRef(null);

  const hasWebcam = project.assets.some((a) => a.type === 'webcam-recording');
  const webcam = project.style.webcam || {};
  const setWebcam = (patch, o) => setStyle({ webcam: { ...webcam, ...patch } }, o);

  // Pauses are found once (FFmpeg silencedetect) and stored in the project.
  async function toggleHideOnSilence(on) {
    setWebcam({ hideOnSilence: on });
    if (!on || project.audioAnalysis) return;
    setDetecting(true);
    try {
      const silences = await window.frameflow.projects.detectSilence(project.id);
      updateProject((p) => {
        p.audioAnalysis = { silences, detectedAt: new Date().toISOString() };
        return p;
      });
    } catch {
      // Without analysis the camera simply stays visible.
    } finally {
      setDetecting(false);
    }
  }

  // The face is found once per recording (a few seconds of local analysis)
  // and stored in the project, so preview and export frame it the same way.
  async function toggleFaceTracking(on) {
    setWebcam({ faceTracking: on });
    if (!on || project.faceTrack) return;
    const asset = project.assets.find((a) => a.type === 'webcam-recording');
    const ctrl = new AbortController();
    faceAbort.current = ctrl;
    setFaceJob({ progress: 0 });
    try {
      const url = await window.frameflow.projects.mediaUrl(project.id, asset.path);
      const faceTrack = await analyzeFaceTrack(url, { signal: ctrl.signal, onProgress: (progress) => setFaceJob({ progress }) });
      if (!faceTrack) {
        setFaceJob({ error: 'No face found in the camera recording.' });
        setWebcam({ faceTracking: false });
        return;
      }
      updateProject((p) => {
        p.faceTrack = faceTrack;
        return p;
      });
      setFaceJob(null);
    } catch (err) {
      setFaceJob(err.message === 'Cancelled' ? null : { error: err.message });
    }
  }

  if (!hasWebcam) {
    return (
      <Section title="Camera">
        <p className="text-[12px] text-slate-300 leading-snug">This recording has no camera track.</p>
        <Hint>Turn the camera on in the recorder bar before recording to add a webcam bubble.</Hint>
      </Section>
    );
  }

  return (
    <>
      <Section title="Camera">
        <Toggle label="Show camera" checked={webcam.enabled !== false} onChange={(v) => setWebcam({ enabled: v })} />
        {webcam.enabled !== false && (
          <>
            <div>
              <Label>Position</Label>
              <div className="grid grid-cols-2 gap-1.5 w-28">
                {POSITIONS.map((pos) => (
                  <button
                    key={pos}
                    title={pos.replace('-', ' ')}
                    onClick={() => setWebcam({ position: pos })}
                    className={`h-9 rounded-[5px] border flex p-1.5 ${pos.startsWith('top') ? 'items-start' : 'items-end'} ${
                      pos.endsWith('left') ? 'justify-start' : 'justify-end'
                    } ${
                      (webcam.position || 'bottom-right') === pos
                        ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300'
                        : 'border-slate-700 bg-slate-950 text-slate-500 hover:border-slate-500'
                    }`}
                  >
                    <span className="w-2.5 h-2.5 rounded-full bg-current" />
                  </button>
                ))}
              </div>
            </div>
            <Slider
              label="Size"
              value={webcam.size ?? 0.22}
              min={0.12}
              max={0.4}
              step={0.01}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(v, o) => setWebcam({ size: v }, o)}
            />
            <div>
              <Label>Shape</Label>
              <Segmented
                options={[
                  { id: 'circle', label: 'Circle' },
                  { id: 'rounded', label: 'Rounded' },
                ]}
                value={webcam.shape || 'circle'}
                onChange={(id) => setWebcam({ shape: id })}
              />
            </div>
            <Toggle
              label="Move out of the cursor’s way"
              checked={webcam.avoidCursor}
              onChange={(v) => setWebcam({ avoidCursor: v })}
            />
            <Toggle
              label="Hide during silence"
              hint={
                detecting
                  ? 'Finding pauses…'
                  : webcam.hideOnSilence && project.audioAnalysis
                    ? `${project.audioAnalysis.silences.length} pause${project.audioAnalysis.silences.length === 1 ? '' : 's'} found`
                    : undefined
              }
              checked={webcam.hideOnSilence}
              onChange={toggleHideOnSilence}
            />
          </>
        )}
      </Section>

      {webcam.enabled !== false && (
        <Section title="Camera look">
          <div className="grid grid-cols-4 gap-1.5">
            {Object.keys(CAMERA_LOOKS).map((id) => (
              <button
                key={id}
                onClick={() => setWebcam({ look: id })}
                className={`rounded-[6px] border overflow-hidden text-[10.5px] ${
                  (webcam.look || 'natural') === id ? 'border-indigo-500 ring-1 ring-indigo-500 text-white' : 'border-slate-700 text-slate-300 hover:border-slate-500'
                }`}
              >
                <span
                  className="block h-7 bg-[linear-gradient(135deg,#e7b48f_0%,#c98463_35%,#4d6c8f_70%,#2c3e55_100%)]"
                  style={{ filter: cameraLookFilter(id, 1) }}
                />
                <span className="block py-0.5">{LOOK_LABELS[id]}</span>
              </button>
            ))}
          </div>
          {(webcam.look || 'natural') !== 'natural' && (
            <Slider
              label="Strength"
              value={webcam.lookStrength ?? 0.7}
              min={0}
              max={1}
              step={0.05}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(v, o) => setWebcam({ lookStrength: v }, o)}
            />
          )}
          <Slider
            label="Sharpen"
            value={webcam.sharpen ?? 0}
            min={0}
            max={1}
            step={0.05}
            format={(v) => (v === 0 ? 'Off' : `${Math.round(v * 100)}%`)}
            onChange={(v, o) => setWebcam({ sharpen: v }, o)}
          />
          <Toggle
            label="Face tracking"
            hint={
              faceJob?.progress != null
                ? `Finding your face… ${Math.round(faceJob.progress * 100)}%`
                : faceJob?.error || 'Keeps the picture centred on your face as you move.'
            }
            checked={Boolean(webcam.faceTracking)}
            onChange={toggleFaceTracking}
          />
          {faceJob?.progress != null && (
            <button onClick={() => faceAbort.current?.abort()} className="text-[11px] text-slate-400 hover:text-slate-200">
              Cancel
            </button>
          )}
          <Hint>Sharpening adds detail without halos around edges or faces. Looks, sharpening and face tracking run on this computer.</Hint>
        </Section>
      )}

      {webcam.enabled !== false && (
        <Section title="Layouts">
          <p className="text-[12px] text-slate-300 leading-snug">
            Add a layout block at the playhead. One recording can switch layouts as often as the story needs.
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {LAYOUT_OPTIONS.map((l) => (
              <button
                key={l.id}
                onClick={() => actions.addLayout(l.id)}
                className="h-8 rounded-[5px] border border-slate-700 bg-slate-950 hover:border-slate-500 text-[12px] text-slate-200"
              >
                + {l.label}
              </button>
            ))}
          </div>
          <Hint>
            Outside layout blocks the camera is the bubble above; switches animate smoothly. Camera cutout
            removes your background on this computer, nothing is uploaded.
          </Hint>
        </Section>
      )}
    </>
  );
}
