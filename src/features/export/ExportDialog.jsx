import React, { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '../../stores/editor-store.js';
import { runExport, resolutionOptions } from '../../engine/export-planner.js';
import { toSrt } from '../../engine/srt.js';
import { totalDuration } from '../../engine/timeline-engine.js';
import { ShareLinkBox } from '../share/ShareLinks.jsx';

const QUALITY_OPTIONS = [
  { id: 'high', label: 'High' },
  { id: 'balanced', label: 'Balanced' },
  { id: 'small', label: 'Small file' },
];

const ENCODER_NAMES = {
  h264_nvenc: 'NVIDIA NVENC',
  h264_qsv: 'Intel Quick Sync',
  h264_amf: 'AMD AMF',
  libx264: 'CPU (x264)',
};

export default function ExportDialog({ videoUrl, webcamUrl, onClose }) {
  const project = useEditorStore((s) => s.project);
  const cursorTrack = useEditorStore((s) => s.cursorTrack);
  const [format, setFormat] = useState('mp4');
  const options = resolutionOptions(project.project.width, project.project.height, format);
  const [resolution, setResolution] = useState('1080p');
  const [fps, setFps] = useState(30);
  const [quality, setQuality] = useState('high');
  const [hardware, setHardware] = useState(true);
  const [gpu, setGpu] = useState(undefined); // undefined = probing, null = none
  const [copied, setCopied] = useState(null);
  const hasCaptions = (project.captions || []).some((c) => c.text && c.text.trim());
  const [saveSrt, setSaveSrt] = useState(true);

  useEffect(() => {
    window.frameflow.export.encoders().then((e) => setGpu(e.hardware)).catch(() => setGpu(null));
  }, []);
  const [state, setState] = useState('idle'); // idle | running | done | error
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const cancelRef = useRef(false);

  async function start() {
    const res = options.find((r) => r.id === resolution) || options[options.length - 1];
    cancelRef.current = false;
    setCopied(null);
    setState('running');
    setProgress(0);
    try {
      const out = await runExport({
        project,
        videoUrl,
        webcamUrl,
        cursorTrack,
        width: res.width,
        height: res.height,
        // GIFs are palette-limited; rendering above 15 fps just wastes time.
        fps: format === 'gif' ? 15 : fps,
        format,
        quality,
        hardware,
        onProgress: setProgress,
        shouldCancel: () => cancelRef.current,
      });
      if (out.cancelled) {
        setState('idle');
      } else {
        if (hasCaptions && saveSrt && format === 'mp4') {
          const srt = toSrt(project.captions, totalDuration(project.clips));
          const written = await window.frameflow.export.writeSrt(project.id, out.outputPath, srt).catch(() => null);
          if (written) out.srtPath = written.srtPath;
        }
        setResult(out);
        setState('done');
      }
    } catch (err) {
      setError(String(err.message || err));
      setState('error');
    }
  }

  function close() {
    if (state === 'running') {
      cancelRef.current = true;
      return;
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-slate-900 border border-slate-700 rounded-xl w-[26rem] p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Export video</h2>

        {state === 'idle' && (
          <>
            <label className="text-xs text-slate-400 block mb-1.5">Format</label>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {[
                { id: 'mp4', label: 'MP4', hint: 'video + audio' },
                { id: 'gif', label: 'GIF', hint: 'silent loop, 15 fps' },
              ].map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFormat(f.id)}
                  className={`rounded-lg border px-3 py-2 text-left ${
                    format === f.id
                      ? 'border-indigo-400 bg-indigo-950/50'
                      : 'border-slate-700 bg-slate-800/60 hover:border-slate-500'
                  }`}
                >
                  <div className="text-sm text-slate-100">{f.label}</div>
                  <div className="text-[10px] text-slate-500">{f.hint}</div>
                </button>
              ))}
            </div>

            <label className="text-xs text-slate-400 block mb-1.5">Resolution</label>
            <select
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm mb-4"
            >
              {options.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>

            {format === 'mp4' && (
              <>
                <label className="text-xs text-slate-400 block mb-1.5">Frame rate</label>
                <select
                  value={fps}
                  onChange={(e) => setFps(Number(e.target.value))}
                  className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm mb-4"
                >
                  <option value={24}>24 fps</option>
                  <option value={30}>30 fps</option>
                  <option value={60}>60 fps</option>
                </select>

                <label className="text-xs text-slate-400 block mb-1.5">Quality</label>
                <div className="grid grid-cols-3 gap-1.5 mb-4">
                  {QUALITY_OPTIONS.map((q) => (
                    <button
                      key={q.id}
                      onClick={() => setQuality(q.id)}
                      className={`rounded-md border py-1.5 text-xs ${
                        quality === q.id
                          ? 'border-indigo-400 bg-indigo-950/50 text-white'
                          : 'border-slate-700 bg-slate-800/60 text-slate-300 hover:border-slate-500'
                      }`}
                    >
                      {q.label}
                    </button>
                  ))}
                </div>

                {hasCaptions && (
                  <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer mb-2">
                    <input
                      type="checkbox"
                      checked={saveSrt}
                      onChange={(e) => setSaveSrt(e.target.checked)}
                      className="accent-indigo-500"
                    />
                    Also save captions as .srt
                  </label>
                )}
                <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer mb-6">
                  <input
                    type="checkbox"
                    checked={hardware && Boolean(gpu)}
                    disabled={!gpu}
                    onChange={(e) => setHardware(e.target.checked)}
                    className="accent-indigo-500"
                  />
                  <span>
                    GPU encoding{' '}
                    <span className="text-[11px] text-slate-500">
                      {gpu === undefined ? '(checking…)' : gpu ? `(${ENCODER_NAMES[gpu]})` : '(not available)'}
                    </span>
                  </span>
                </label>
              </>
            )}
            {format === 'gif' && <div className="mb-2" />}

            <div className="flex gap-3">
              <button
                onClick={start}
                className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg py-2.5 font-medium"
              >
                Export {format.toUpperCase()}
              </button>
              <button onClick={close} className="px-4 text-slate-400 hover:text-white text-sm">
                Cancel
              </button>
            </div>
          </>
        )}

        {state === 'running' && (
          <>
            <div className="h-2 bg-slate-800 rounded overflow-hidden mb-2">
              <div
                className="h-full bg-indigo-500 transition-[width]"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-slate-400 mb-5">
              <span>{progress >= 1 ? 'Encoding…' : 'Rendering frames…'}</span>
              <span className="tabular-nums">{Math.round(progress * 100)}%</span>
            </div>
            <button
              onClick={close}
              className="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg py-2.5 text-sm"
            >
              Cancel export
            </button>
          </>
        )}

        {state === 'done' && result && (
          <>
            <p className="text-emerald-300 text-sm mb-1">✓ Export complete</p>
            <p className="text-xs text-slate-400 break-all mb-1">{result.outputPath}</p>
            {result.srtPath && <p className="text-[11px] text-slate-500 break-all mb-1">+ captions: {result.srtPath}</p>}
            <p className="text-[11px] text-slate-500 mb-5">
              {(result.bytes / 1048576).toFixed(1)} MB
              {result.encoder ? ` · ${ENCODER_NAMES[result.encoder] || result.encoder}` : ''}
            </p>
            <button
              onClick={async () => {
                try {
                  await window.frameflow.export.copyToClipboard(project.id, result.outputPath);
                  setCopied('ok');
                } catch {
                  setCopied('error');
                }
              }}
              className="w-full mb-3 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg py-2 text-sm"
            >
              {copied === 'ok' ? '✓ Copied — paste it anywhere' : copied === 'error' ? 'Copy failed' : '⧉ Copy file to clipboard'}
            </button>
            <ShareLinkBox project={project} filePath={result.outputPath} />
            <div className="flex gap-3">
              <button
                onClick={() => window.frameflow.projects.revealExports(project.id)}
                className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg py-2.5 text-sm font-medium"
              >
                Open folder
              </button>
              <button
                onClick={onClose}
                className="px-4 text-slate-400 hover:text-white text-sm"
              >
                Close
              </button>
            </div>
          </>
        )}

        {state === 'error' && (
          <>
            <p className="text-red-300 text-sm mb-4 break-words">{error}</p>
            <div className="flex gap-3">
              <button
                onClick={() => setState('idle')}
                className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg py-2.5 text-sm"
              >
                Try again
              </button>
              <button onClick={onClose} className="px-4 text-slate-400 hover:text-white text-sm">
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
