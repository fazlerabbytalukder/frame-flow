import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useEditorStore } from '../../../stores/editor-store.js';
import { useEditorActions } from '../editor-context.js';
import { fillerAndPauseCuts, isFiller, rebuildAutoCaptions, wordRanges, wordsOnTimeline } from '../../../engine/transcript.js';
import { Button, Hint, Label, Section, Slider, Toggle } from './controls.jsx';

// Edit by transcript: the recording's words, transcribed on this computer.
// Select words and delete them to cut them from the video; filler words and
// long pauses can go in one pass; captions can be made from the words.

export const LANGUAGES = [
  ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'],
  ['it', 'Italian'], ['pt', 'Portuguese'], ['nl', 'Dutch'], ['pl', 'Polish'], ['tr', 'Turkish'], ['ru', 'Russian'],
  ['uk', 'Ukrainian'], ['hi', 'Hindi'], ['bn', 'Bengali'], ['ur', 'Urdu'], ['ar', 'Arabic'], ['zh', 'Chinese'],
  ['ja', 'Japanese'], ['ko', 'Korean'], ['id', 'Indonesian'], ['vi', 'Vietnamese'], ['th', 'Thai'],
];

// Polls a running transcription for this project; resolves the result into
// the project (one undo step) when it finishes.
export function useTranscription(project) {
  const updateProject = useEditorStore((s) => s.updateProject);
  const rebuildCaptions = useEditorStore((s) => s.rebuildCaptions);
  const [job, setJob] = useState({ state: 'idle', progress: 0 });
  const timer = useRef(null);
  const withCaptions = useRef(false);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const st = await window.frameflow.transcript.status(project.id).catch((err) => ({ state: 'error', error: err.message }));
      if (!alive) return;
      setJob(st);
      if (st.state === 'running') timer.current = setTimeout(poll, 400);
      else if (st.state === 'done' && st.result) {
        updateProject((p) => {
          // Captions made from the old transcript keep following the new one.
          const captions = Boolean(p.transcript?.captions || p.captions.some((c) => c.auto));
          p.transcript = { words: st.result.words, language: st.result.language, model: st.result.model, captions };
          if (captions) rebuildAutoCaptions(p);
          return p;
        });
        if (withCaptions.current) rebuildCaptions();
      }
    };
    poll();
    return () => {
      alive = false;
      clearTimeout(timer.current);
    };
    // Re-run when a new job starts (job.started bumps).
  }, [project.id, job.started]); // eslint-disable-line react-hooks/exhaustive-deps

  async function start(language, captions) {
    withCaptions.current = captions;
    try {
      await window.frameflow.transcript.start(project.id, language);
      setJob({ state: 'running', progress: 0, started: Date.now() });
    } catch (err) {
      setJob({ state: 'error', progress: 0, error: err.message });
    }
  }
  return { job, start };
}

export function TranscribeForm({ project, cta = 'Transcribe recording', captionsDefault = false }) {
  const { job, start } = useTranscription(project);
  const [language, setLanguage] = useState('en');
  const [captions, setCaptions] = useState(captionsDefault);
  const running = job.state === 'running';
  return (
    <div className="space-y-2.5">
      <div>
        <Label>Spoken language</Label>
        <select
          value={language}
          disabled={running}
          onChange={(e) => setLanguage(e.target.value)}
          className="w-full h-8 px-2 rounded-[5px] bg-slate-950 border border-slate-700 text-[12px] text-slate-200 outline-none focus:border-indigo-500"
        >
          {LANGUAGES.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <Toggle label="Also create captions" checked={captions} onChange={setCaptions} />
      {running ? (
        <div className="space-y-1.5">
          <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
            <div className="h-full bg-indigo-500 transition-[width]" style={{ width: `${Math.round((job.progress || 0) * 100)}%` }} />
          </div>
          <Hint>Transcribing on this computer… {Math.round((job.progress || 0) * 100)}%</Hint>
        </div>
      ) : (
        <Button tone="primary" className="w-full" onClick={() => start(language, captions)}>
          {cta}
        </Button>
      )}
      {job.state === 'error' && <Hint tone="warn">{job.error || 'Transcription failed.'}</Hint>}
    </div>
  );
}

export default function TranscriptPanel() {
  const project = useEditorStore((s) => s.project);
  const currentTime = useEditorStore((s) => s.currentTime);
  const cutTranscript = useEditorStore((s) => s.cutTranscript);
  const rebuildCaptions = useEditorStore((s) => s.rebuildCaptions);
  const actions = useEditorActions();
  const [sel, setSel] = useState(null); // { a, b } positions in the shown list
  const [pause, setPause] = useState(0.8);
  const dragging = useRef(false);

  const transcript = project.transcript;
  const words = useMemo(() => (transcript ? wordsOnTimeline(project) : []), [transcript, project.clips]); // eslint-disable-line react-hooks/exhaustive-deps

  const kept = useMemo(() => words.map((w) => ({ ...transcript.words[w.index], index: w.index })), [words, transcript]);
  const fillerCount = kept.filter((w) => isFiller(w.text)).length;
  const pauseCount = kept.reduce((n, w, i) => n + (i + 1 < kept.length && kept[i + 1].start - w.end > pause ? 1 : 0), 0);

  useEffect(() => {
    const up = () => (dragging.current = false);
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  if (!transcript) {
    return (
      <Section title="Transcript">
        <p className="text-[12px] text-slate-300 leading-snug">
          Turn the recording’s speech into text, then edit the video by editing the words.
        </p>
        <TranscribeForm project={project} />
        <Hint>Speech recognition runs on this computer (Whisper). The audio is never uploaded.</Hint>
      </Section>
    );
  }

  const lo = sel ? Math.min(sel.a, sel.b) : -1;
  const hi = sel ? Math.max(sel.a, sel.b) : -1;
  const current = words.findIndex((w) => currentTime >= w.start && currentTime < w.end);

  function deleteSelection() {
    if (!sel) return;
    const indices = words.slice(lo, hi + 1).map((w) => w.index);
    cutTranscript(wordRanges(transcript.words, indices));
    setSel(null);
  }

  function removeFillersAndPauses({ fillers, pauses }) {
    cutTranscript(fillerAndPauseCuts(kept, { fillers, pauses, pause, keep: 0.3 }));
    setSel(null);
  }

  return (
    <>
      <Section title={`Transcript (${words.length} words)`}>
        <div
          tabIndex={0}
          onKeyDown={(e) => {
            if ((e.key === 'Backspace' || e.key === 'Delete') && sel) {
              e.preventDefault();
              e.stopPropagation();
              deleteSelection();
            } else if (e.key === 'Escape') setSel(null);
          }}
          className="max-h-[340px] overflow-y-auto ff-scroll rounded-[6px] bg-slate-950 border border-slate-700 p-2.5 text-[13px] leading-[1.7] text-slate-200 outline-none focus:border-indigo-500 select-none"
        >
          {words.length === 0 && <span className="text-slate-500">No speech left in the edit.</span>}
          {words.map((w, i) => {
            const selected = i >= lo && i <= hi;
            const filler = isFiller(w.text);
            return (
              <span
                key={w.index}
                onMouseDown={(e) => {
                  dragging.current = true;
                  if (e.shiftKey && sel) setSel({ a: sel.a, b: i });
                  else setSel({ a: i, b: i });
                  actions.seek(w.start);
                }}
                onMouseEnter={() => dragging.current && setSel((s) => (s ? { a: s.a, b: i } : s))}
                className={`cursor-pointer rounded-[3px] px-[1px] ${
                  selected
                    ? 'bg-indigo-600 text-white'
                    : i === current
                      ? 'bg-slate-700 text-white'
                      : filler
                        ? 'text-amber-300/90 hover:bg-slate-800'
                        : 'hover:bg-slate-800'
                }`}
              >
                {w.text}{' '}
              </span>
            );
          })}
        </div>
        <div className="flex gap-1.5">
          <Button tone="danger" className="flex-1" disabled={!sel} onClick={deleteSelection} title="Delete (Backspace)">
            Cut selected words
          </Button>
          <Button className="shrink-0" disabled={!sel} onClick={() => setSel(null)}>
            Clear
          </Button>
        </div>
        <Hint>Click a word to jump to it; drag or Shift-click to select. Cutting removes that part of the video. Undo brings it back.</Hint>
      </Section>

      <Section title="Filler words & pauses">
        <p className="text-[12px] text-slate-300">
          {fillerCount} filler word{fillerCount === 1 ? '' : 's'} (um, uh…) and {pauseCount} pause{pauseCount === 1 ? '' : 's'} longer
          than {pause.toFixed(1)} s.
        </p>
        <Slider label="Long pause" value={pause} min={0.4} max={3} step={0.1} format={(v) => `${v.toFixed(1)} s`} onChange={setPause} />
        <Button tone="primary" className="w-full" disabled={fillerCount + pauseCount === 0} onClick={() => removeFillersAndPauses({ fillers: true, pauses: true })}>
          Remove fillers and shorten pauses
        </Button>
        <div className="flex gap-1.5">
          <Button className="flex-1" disabled={fillerCount === 0} onClick={() => removeFillersAndPauses({ fillers: true, pauses: false })}>
            Fillers only
          </Button>
          <Button className="flex-1" disabled={pauseCount === 0} onClick={() => removeFillersAndPauses({ fillers: false, pauses: true })}>
            Pauses only
          </Button>
        </div>
        <Hint>Pauses are shortened to 0.3 s, not removed, so speech keeps its rhythm.</Hint>
      </Section>

      <Section title="Captions from speech">
        <Button className="w-full" onClick={rebuildCaptions}>
          {transcript.captions ? 'Rebuild captions from transcript' : 'Create captions from transcript'}
        </Button>
        <Hint>Captions made from speech follow your transcript edits. Style them in the Captions panel.</Hint>
      </Section>

      <Section title="Transcribe again">
        <TranscribeForm project={project} cta="Replace transcript" />
      </Section>
    </>
  );
}
