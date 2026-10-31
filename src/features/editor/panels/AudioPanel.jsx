import React from 'react';
import { useEditorStore } from '../../../stores/editor-store.js';
import { CloseIcon, UploadIcon } from '../../../ui/icons.jsx';
import { Button, Hint, Label, Section, Segmented, Slider, Toggle } from './controls.jsx';

const VOICE_HINTS = {
  standard: 'Your microphone as it was, with the keyboard and the room still in it.',
  noise: 'Fans, keyboards and hum turned down; your voice keeps its character.',
  podcast: 'Noise reduction plus a voice chain (rumble cut, de-essing, gentle compression, presence) for lessons and walkthroughs.',
};

export default function AudioPanel() {
  const project = useEditorStore((s) => s.project);
  const setStyle = useEditorStore((s) => s.setStyle);
  const audio = project.style.audio || {};
  const setAudio = (patch, o) => setStyle({ audio: { ...audio, ...patch } }, o);

  async function chooseMusic() {
    const music = await window.frameflow.projects.chooseMusic(project.id).catch(() => null);
    if (music) setAudio({ music });
  }

  return (
    <>
      <Section title="Recording">
        <Slider
          label="Volume"
          value={project.style.volume ?? 1}
          min={0}
          max={1.5}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v, o) => setStyle({ volume: v }, o)}
        />
        <div>
          <Label>Voice</Label>
          <Segmented
            options={[
              { id: 'standard', label: 'Standard' },
              { id: 'noise', label: 'Noise reduction' },
              { id: 'podcast', label: 'Podcast' },
            ]}
            value={audio.voice || (audio.denoise ? 'noise' : 'standard')}
            onChange={(id) => setAudio({ voice: id, denoise: id !== 'standard' })}
          />
          <p className="mt-1.5 text-[11px] leading-snug text-slate-400">{VOICE_HINTS[audio.voice || (audio.denoise ? 'noise' : 'standard')]}</p>
        </div>
        <Toggle label="Even out loudness" checked={audio.normalize} onChange={(v) => setAudio({ normalize: v })} />
        <Toggle label="Click sounds" checked={audio.clickSounds} onChange={(v) => setAudio({ clickSounds: v })} />
        {audio.clickSounds && (
          <Slider
            label="Click volume"
            value={audio.clickVolume ?? 0.6}
            min={0}
            max={1}
            step={0.05}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v, o) => setAudio({ clickVolume: v }, o)}
          />
        )}
        <Hint>Voice clean-up, loudness and click sounds are applied on export, on this computer.</Hint>
      </Section>

      <Section title="Music">
        {audio.music ? (
          <>
            <div className="flex items-center gap-2 h-8 px-2.5 rounded-[5px] bg-slate-950 border border-slate-700">
              <span className="flex-1 truncate text-[12px] text-slate-200" title={audio.music.name}>
                {audio.music.name || 'Music'}
              </span>
              <button
                onClick={() => setAudio({ music: null })}
                className="text-slate-500 hover:text-red-400"
                title="Remove music"
              >
                <CloseIcon size={13} />
              </button>
            </div>
            <Slider
              label="Music volume"
              value={audio.music.volume ?? 0.25}
              min={0}
              max={1}
              step={0.05}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(v, o) => setAudio({ music: { ...audio.music, volume: v } }, o)}
            />
          </>
        ) : (
          <Button onClick={chooseMusic} className="w-full">
            <UploadIcon size={14} /> Add music file…
          </Button>
        )}
        <Hint>Music loops to the video length and fades out at the end.</Hint>
      </Section>
    </>
  );
}
