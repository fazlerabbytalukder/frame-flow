import React, { useEffect, useState } from 'react';

// Shareable links on the local network: Frame Studio hosts an exported video
// for people on the same Wi-Fi or office network. They watch in a browser and
// comment at exact seconds; here the owner sees views and comments.

function fmt(t) {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Re-reads the share list every few seconds while mounted.
export function useShares() {
  const [data, setData] = useState({ shares: [], status: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () =>
      window.frameflow.share
        .list()
        .then((d) => alive && setData(d))
        .catch(() => {});
    load();
    const t = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [tick]);
  return { ...data, refresh: () => setTick((n) => n + 1) };
}

// Create a link for one exported file (shown after an export).
export function ShareLinkBox({ project, filePath }) {
  const { shares, refresh } = useShares();
  const [passcode, setPasscode] = useState('');
  const [showViews, setShowViews] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const name = filePath.split(/[\\/]/).pop();
  const share = shares.find((s) => s.projectId === project.id && s.fileName === name);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await window.frameflow.share.create(project.id, filePath, { title: project.project.name, passcode, showViews });
      refresh();
    } catch (err) {
      setError(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    } finally {
      setBusy(false);
    }
  }

  if (share) return <ShareRow share={share} onChange={refresh} compact />;
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3 mb-3 space-y-2">
      <div className="text-[12.5px] text-slate-200 font-medium">Share a link on your network</div>
      <p className="text-[11px] text-slate-500 leading-snug">
        People on the same Wi-Fi or office network watch in their browser and can comment at exact seconds. Nothing is uploaded;
        your computer hosts the video while Frame Studio is open.
      </p>
      <div className="flex gap-2">
        <input
          value={passcode}
          onChange={(e) => setPasscode(e.target.value.slice(0, 32))}
          placeholder="Passcode (optional)"
          className="flex-1 min-w-0 h-8 px-2.5 rounded-[5px] bg-slate-950 border border-slate-700 focus:border-indigo-500 outline-none text-[12px] text-slate-100 placeholder:text-slate-500"
        />
        <label className="flex items-center gap-1.5 text-[11.5px] text-slate-300 whitespace-nowrap">
          <input type="checkbox" checked={showViews} onChange={(e) => setShowViews(e.target.checked)} />
          Show view count
        </label>
      </div>
      <button
        onClick={create}
        disabled={busy}
        className="w-full bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-lg py-2 text-sm disabled:opacity-60"
      >
        {busy ? 'Starting…' : 'Create share link'}
      </button>
      <p className="text-[10.5px] text-slate-500">Windows may ask once to let Frame Studio through the firewall. Allow it on private networks.</p>
      {error && <p className="text-[11.5px] text-red-400">{error}</p>}
    </div>
  );
}

export function ShareRow({ share, onChange, compact }) {
  const [open, setOpen] = useState(compact);
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3 mb-3 text-left">
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-[12.5px] text-slate-100 truncate">{share.title}</div>
          <div className="text-[11px] text-slate-500 truncate">
            {share.views} view{share.views === 1 ? '' : 's'} · {share.comments.length} comment{share.comments.length === 1 ? '' : 's'}
            {share.hasPasscode ? ' · passcode' : ''}
            {share.missing ? ' · video file missing' : ''}
          </div>
        </div>
        <button
          onClick={async () => {
            await window.frameflow.share.copyLink(share.id).catch(() => {});
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="h-7 px-2.5 rounded-[5px] bg-indigo-600 hover:bg-indigo-500 text-white text-[11.5px]"
        >
          {copied ? 'Copied' : 'Copy link'}
        </button>
        <button
          onClick={async () => {
            await window.frameflow.share.stop(share.id).catch(() => {});
            onChange?.();
          }}
          className="h-7 px-2.5 rounded-[5px] border border-red-500/40 text-red-400 hover:bg-red-600/15 text-[11.5px]"
        >
          Stop
        </button>
      </div>
      {share.url && <div className="mt-1.5 text-[11px] text-slate-400 font-mono break-all select-all">{share.url}</div>}
      {share.comments.length > 0 && (
        <>
          <button onClick={() => setOpen((v) => !v)} className="mt-2 text-[11px] text-indigo-400 hover:text-indigo-300">
            {open ? 'Hide comments' : 'Show comments'}
          </button>
          {open && (
            <div className="mt-1.5 max-h-48 overflow-y-auto ff-scroll divide-y divide-black/40">
              {share.comments.map((c) => (
                <div key={c.id} className="py-1.5 flex gap-2 text-[12px]">
                  <span className="text-indigo-300 tabular-nums shrink-0">{fmt(c.t)}</span>
                  <span className="flex-1 min-w-0">
                    <span className="text-slate-200 font-medium">{c.name}</span>{' '}
                    <span className="text-slate-300 break-words">{c.text}</span>
                  </span>
                  <button
                    onClick={async () => {
                      await window.frameflow.share.removeComment(share.id, c.id).catch(() => {});
                      onChange?.();
                    }}
                    className="text-slate-500 hover:text-red-400 text-[11px] shrink-0"
                    title="Delete comment"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// All active links (library page).
export function SharedLinksSection() {
  const { shares, status, refresh } = useShares();
  if (shares.length === 0) return null;
  return (
    <section className="mb-8">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-[13px] font-semibold text-slate-200">Shared links</h2>
        {status?.running && <span className="text-[11px] text-slate-500">Sharing on {status.address}:{status.port}</span>}
      </div>
      <div className="grid gap-0 md:grid-cols-2 md:gap-x-3">
        {shares.map((s) => (
          <ShareRow key={s.id} share={s} onChange={refresh} />
        ))}
      </div>
    </section>
  );
}
