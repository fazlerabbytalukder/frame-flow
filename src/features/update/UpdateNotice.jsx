import React, { useEffect, useState } from 'react';

// Bottom-right card in the library/editor window when a new version is on
// GitHub Releases: Download → progress → Restart to update. The main process
// (electron/services/updater.js) holds the state and refuses to restart while
// a recording runs. "Later" hides it until the next version shows up.

const DISMISSED_KEY = 'frameflow.updateDismissed';

function readDismissed() {
  try {
    return localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

export default function UpdateNotice() {
  const [state, setState] = useState(null);
  const [dismissed, setDismissed] = useState(readDismissed);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const api = window.frameflow && window.frameflow.update;
    if (!api) return undefined;
    api.state().then(setState).catch(() => {});
    return api.onState(setState);
  }, []);

  if (!state || !state.version) return null;
  const { status, version, percent, notes, error } = state;
  if (!['available', 'downloading', 'ready', 'error'].includes(status)) return null;
  if (status === 'available' && dismissed === version) return null;

  const later = () => {
    setDismissed(version);
    try {
      localStorage.setItem(DISMISSED_KEY, version);
    } catch {
      // Not remembered; it shows again next launch.
    }
  };
  const download = () => window.frameflow.update.download();
  const restart = async () => {
    const res = await window.frameflow.update.install();
    if (!res.ok) setMessage(res.reason);
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[320px] rounded-[9px] bg-slate-900 border border-slate-700 shadow-2xl shadow-black/60 p-4 text-[13px] text-slate-200">
      <div className="flex items-center gap-2 font-semibold text-slate-50">
        <span className="w-2 h-2 rounded-full bg-indigo-500" />
        {status === 'ready' ? `Frame Studio ${version} is ready` : `Frame Studio ${version} is available`}
      </div>

      {status === 'available' && notes && (
        <p className="mt-2 max-h-28 overflow-y-auto whitespace-pre-line text-[12px] text-slate-400">{notes}</p>
      )}

      {status === 'downloading' && (
        <div className="mt-3">
          <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
            <div className="h-full bg-indigo-500 transition-[width]" style={{ width: `${percent}%` }} />
          </div>
          <div className="mt-1.5 text-[12px] text-slate-400">Downloading… {percent}%</div>
        </div>
      )}

      {status === 'ready' && (
        <p className="mt-2 text-[12px] text-slate-400">Restart to finish updating. It also installs the next time you quit.</p>
      )}

      {status === 'error' && <p className="mt-2 text-[12px] text-red-400">{error}</p>}
      {message && <p className="mt-2 text-[12px] text-amber-400">{message}</p>}

      <div className="mt-3 flex justify-end gap-2">
        {status === 'available' && (
          <button onClick={later} className="h-8 px-3 rounded-[6px] text-slate-300 hover:bg-slate-800">
            Later
          </button>
        )}
        {(status === 'available' || status === 'error') && (
          <button onClick={download} className="h-8 px-3 rounded-[6px] bg-indigo-500 hover:bg-indigo-400 text-white font-medium">
            {status === 'error' ? 'Try again' : 'Download'}
          </button>
        )}
        {status === 'ready' && (
          <button onClick={restart} className="h-8 px-3 rounded-[6px] bg-indigo-500 hover:bg-indigo-400 text-white font-medium">
            Restart to update
          </button>
        )}
      </div>
    </div>
  );
}
