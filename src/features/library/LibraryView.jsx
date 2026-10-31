import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../stores/app-store.js';
import Menu, { MenuDivider, MenuItem, MenuLabel } from '../editor/Menu.jsx';
import { SharedLinksSection } from '../share/ShareLinks.jsx';
import {
  AlertIcon, CameraIcon, CaptionsIcon, ChevronDownIcon, FolderIcon, GridIcon, ListIcon, LockIcon, MoreIcon, PencilIcon,
  PlayIcon, RecordIcon, SearchIcon, TrashIcon, UploadIcon,
} from '../../ui/icons.jsx';
import LogoMark from '../../ui/LogoMark.jsx';

// The library: every recording on this computer, with thumbnails, search,
// sorting, and a grid or list view. Interrupted recordings and active share
// links show above the projects.

const PREFS_KEY = 'frameflow.library';

const SORTS = [
  { id: 'newest', label: 'Newest first', fn: (a, b) => (a.createdAt < b.createdAt ? 1 : -1) },
  { id: 'oldest', label: 'Oldest first', fn: (a, b) => (a.createdAt > b.createdAt ? 1 : -1) },
  { id: 'edited', label: 'Recently edited', fn: (a, b) => ((a.updatedAt || '') < (b.updatedAt || '') ? 1 : -1) },
  { id: 'name', label: 'Name', fn: (a, b) => a.name.localeCompare(b.name) },
  { id: 'longest', label: 'Longest', fn: (a, b) => (b.duration || 0) - (a.duration || 0) },
];

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
  } catch {
    return {};
  }
}

function formatDuration(seconds) {
  if (!seconds) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function relativeTime(iso, now = Date.now()) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const min = Math.round((now - t) / 60000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.floor((new Date(now).setHours(0, 0, 0, 0) - new Date(t).setHours(0, 0, 0, 0)) / 86400000);
  if (days <= 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  const d = new Date(t);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(d.getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {}) });
}

function aspectLabel(w, h) {
  if (!w || !h) return null;
  const r = w / h;
  if (Math.abs(r - 16 / 9) < 0.02) return null; // the default needs no badge
  if (Math.abs(r - 9 / 16) < 0.02) return '9:16';
  if (Math.abs(r - 1) < 0.02) return '1:1';
  if (Math.abs(r - 4 / 5) < 0.02) return '4:5';
  if (Math.abs(r - 4 / 3) < 0.02) return '4:3';
  return `${w}×${h}`;
}

// Thumbnails come from FFmpeg (cached on disk); at most two are made at once.
const thumbCache = new Map();
let running = 0;
const waiting = [];
function loadThumb(id) {
  if (!thumbCache.has(id)) {
    thumbCache.set(
      id,
      new Promise((resolve) => {
        const go = () => {
          running++;
          window.frameflow.projects
            .thumbnail(id)
            .catch(() => null)
            .then((url) => {
              running--;
              resolve(url);
              waiting.shift()?.();
            });
        };
        if (running < 2) go();
        else waiting.push(go);
      })
    );
  }
  return thumbCache.get(id);
}

function Thumbnail({ id, className = '' }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let alive = true;
    loadThumb(id).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [id]);
  return (
    // `className` positions it (absolute in a card, relative in a list row).
    <div className={`overflow-hidden bg-[radial-gradient(120%_120%_at_30%_20%,#2b3442_0%,#171a20_70%)] ${className}`}>
      {url ? (
        <img src={url} alt="" draggable={false} className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
      ) : (
        <div className="absolute inset-0 animate-pulse bg-white/[0.03]" />
      )}
    </div>
  );
}

function Badge({ children, title }) {
  return (
    <span title={title} className="inline-flex items-center gap-1 h-5 px-1.5 rounded-[4px] bg-black/65 backdrop-blur-sm text-[10.5px] font-medium text-white/90">
      {children}
    </span>
  );
}

function ProjectMenu({ project, onOpen, onRename, onDelete }) {
  return (
    <Menu
      align="right"
      width={190}
      trigger={({ open, toggle }) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggle();
          }}
          title="More"
          className={`w-7 h-7 shrink-0 rounded-[5px] flex items-center justify-center transition-colors ${
            open ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-100 hover:bg-slate-800'
          }`}
        >
          <MoreIcon size={16} />
        </button>
      )}
    >
      {(close) => (
        <>
          <MenuItem icon={<PlayIcon size={14} />} onClick={() => (close(), onOpen())}>
            Open in editor
          </MenuItem>
          <MenuItem icon={<PencilIcon size={14} />} onClick={() => (close(), onRename())}>
            Rename
          </MenuItem>
          <MenuItem icon={<FolderIcon size={14} />} onClick={() => (close(), window.frameflow.projects.revealFolder(project.id))}>
            Show in folder
          </MenuItem>
          <MenuDivider />
          <MenuItem danger icon={<TrashIcon size={14} />} onClick={() => (close(), onDelete())}>
            Delete…
          </MenuItem>
        </>
      )}
    </Menu>
  );
}

function RenameInput({ value, onChange, onCommit, onCancel, className = '' }) {
  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => onChange(e.target.value.slice(0, 120))}
      onBlur={onCommit}
      onFocus={(e) => e.target.select()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit();
        if (e.key === 'Escape') onCancel();
      }}
      className={`min-w-0 bg-slate-950 border border-indigo-500 rounded-[5px] px-2 py-1 text-[13px] text-white outline-none ${className}`}
    />
  );
}

export default function LibraryView() {
  const { openRecorder, openEditor } = useAppStore();
  const [prefs] = useState(loadPrefs);
  const [projects, setProjects] = useState(null);
  const [pending, setPending] = useState([]);
  const [error, setError] = useState(null);
  const [renaming, setRenaming] = useState(null); // { id, value }
  const [confirmDelete, setConfirmDelete] = useState(null); // project
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState(SORTS.some((s) => s.id === prefs.sort) ? prefs.sort : 'newest');
  const [view, setView] = useState(prefs.view === 'list' ? 'list' : 'grid');
  const searchRef = useRef(null);

  async function refresh() {
    try {
      const [list, pend] = await Promise.all([window.frameflow.projects.list(), window.frameflow.recording.listPending()]);
      setProjects(list);
      setPending(pend);
      setError(null);
    } catch (err) {
      setError(String(err.message || err));
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ sort, view }));
    } catch {
      // Remembering the view is only a convenience.
    }
  }, [sort, view]);

  // Ctrl+F focuses search.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (projects || []).filter((p) => !q || p.name.toLowerCase().includes(q));
    return list.sort(SORTS.find((s) => s.id === sort).fn);
  }, [projects, query, sort]);

  const totalSeconds = (projects || []).reduce((s, p) => s + (p.duration || 0), 0);

  async function recover(id) {
    setBusy(true);
    try {
      const project = await window.frameflow.recording.recover(id);
      openEditor(project.id);
    } catch (err) {
      setError(`Recovery failed: ${err.message || err}`);
      setBusy(false);
      refresh();
    }
  }

  async function importVideo() {
    setImporting(true);
    setError(null);
    try {
      const project = await window.frameflow.projects.importVideo();
      if (project) openEditor(project.id);
    } catch (err) {
      setError(`Import failed: ${err.message || err}`);
    } finally {
      setImporting(false);
    }
  }

  async function discardPending(id) {
    await window.frameflow.recording.discardPending(id).catch(() => {});
    refresh();
  }

  async function commitRename() {
    if (!renaming) return;
    const { id, value } = renaming;
    setRenaming(null);
    const name = value.trim();
    if (!name || name === projects.find((p) => p.id === id)?.name) return;
    try {
      await window.frameflow.projects.rename(id, name);
      refresh();
    } catch (err) {
      setError(String(err.message || err));
    }
  }

  async function deleteProject(id) {
    setConfirmDelete(null);
    try {
      await window.frameflow.projects.remove(id);
      thumbCache.delete(id);
      refresh();
    } catch (err) {
      setError(`Could not delete: ${err.message || err}`);
    }
  }

  const rename = (p) => setRenaming({ id: p.id, value: p.name });
  const empty = projects && projects.length === 0 && pending.length === 0;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-950">
      {/* App bar */}
      <header className="h-14 shrink-0 flex items-center gap-4 px-6 bg-slate-900 border-b border-black/60">
        <div className="flex items-center gap-2.5 w-[220px] shrink-0">
          <LogoMark />
          <span className="text-[15px] font-semibold tracking-tight text-slate-50">Frame Studio</span>
        </div>
        <div className="flex-1 flex justify-center">
          <label className="relative w-full max-w-[420px]">
            <SearchIcon size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
              placeholder="Search recordings"
              className="w-full h-9 pl-9 pr-16 rounded-[6px] bg-slate-950 border border-slate-700 hover:border-slate-600 focus:border-indigo-500 outline-none text-[13px] text-slate-100 placeholder:text-slate-500"
            />
            <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 px-1.5 h-5 inline-flex items-center rounded border border-slate-700 text-[10px] text-slate-500 font-sans">
              Ctrl F
            </kbd>
          </label>
        </div>
        <div className="flex items-center justify-end gap-2 min-w-[220px] shrink-0 whitespace-nowrap">
          <button
            onClick={importVideo}
            disabled={importing}
            title="Edit an existing video like a recording"
            className="h-9 px-3.5 rounded-[6px] flex items-center gap-2 border border-slate-700 hover:border-slate-500 hover:bg-slate-800 text-[13px] text-slate-200 disabled:opacity-50 transition-colors"
          >
            <UploadIcon size={15} />
            {importing ? 'Importing…' : 'Import'}
          </button>
          <button
            onClick={openRecorder}
            className="ff-record-btn rounded-[6px] h-9 pl-3 pr-4 text-[13px]"
          >
            <RecordIcon size={16} />
            New recording
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto ff-scroll">
        <div className="max-w-[1240px] mx-auto px-8 py-8">
          {error && (
            <div className="flex items-start gap-3 rounded-[8px] border border-red-500/40 bg-red-500/10 px-4 py-3 mb-6 text-[13px] text-red-200">
              <AlertIcon size={16} className="mt-0.5 shrink-0 text-red-400" />
              <span className="flex-1">{error}</span>
              <button onClick={() => setError(null)} className="text-red-300/70 hover:text-red-100 text-[12px]">
                Dismiss
              </button>
            </div>
          )}

          {pending.map((p) => (
            <div key={p.id} className="flex items-center gap-4 rounded-[8px] border border-amber-500/30 bg-amber-500/[0.07] px-4 py-3 mb-4">
              <span className="w-9 h-9 rounded-full bg-amber-500/15 flex items-center justify-center text-amber-400 shrink-0">
                <AlertIcon size={17} />
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-amber-100">An interrupted recording was found</div>
                <div className="text-[12px] text-amber-200/60 mt-0.5">
                  Started {new Date(p.startedAt).toLocaleString()} · {(p.bytes / 1024 / 1024).toFixed(1)} MB saved
                </div>
              </div>
              <button
                onClick={() => discardPending(p.id)}
                disabled={busy}
                className="h-8 px-3 rounded-[6px] text-[12.5px] text-amber-200/80 hover:text-amber-50 hover:bg-amber-500/10"
              >
                Discard
              </button>
              <button
                onClick={() => recover(p.id)}
                disabled={busy}
                className="h-8 px-4 rounded-[6px] bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-[12.5px] font-semibold text-black"
              >
                {busy ? 'Recovering…' : 'Recover'}
              </button>
            </div>
          ))}

          <SharedLinksSection />

          {empty ? (
            <EmptyState onRecord={openRecorder} onImport={importVideo} />
          ) : (
            <>
              <div className="flex items-end justify-between gap-4 mb-5">
                <div>
                  <h1 className="text-[20px] font-semibold tracking-tight text-slate-50">Recordings</h1>
                  {projects && (
                    <p className="text-[12.5px] text-slate-500 mt-1">
                      {projects.length} recording{projects.length === 1 ? '' : 's'} · {formatDuration(totalSeconds)} total
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Menu
                    align="right"
                    width={180}
                    trigger={({ open, toggle }) => (
                      <button
                        onClick={toggle}
                        className={`h-8 pl-3 pr-2 rounded-[6px] flex items-center gap-1.5 border text-[12.5px] transition-colors ${
                          open ? 'border-slate-500 bg-slate-800 text-white' : 'border-slate-700 text-slate-300 hover:border-slate-500'
                        }`}
                      >
                        <span className="text-slate-500">Sort:</span> {SORTS.find((s) => s.id === sort).label}
                        <ChevronDownIcon size={14} className="text-slate-500" />
                      </button>
                    )}
                  >
                    {(close) => (
                      <>
                        <MenuLabel>Sort by</MenuLabel>
                        {SORTS.map((s) => (
                          <MenuItem key={s.id} checked={s.id === sort} onClick={() => (setSort(s.id), close())}>
                            {s.label}
                          </MenuItem>
                        ))}
                      </>
                    )}
                  </Menu>
                  <div className="flex h-8 p-0.5 rounded-[6px] border border-slate-700">
                    {[
                      ['grid', GridIcon, 'Grid'],
                      ['list', ListIcon, 'List'],
                    ].map(([id, Icon, label]) => (
                      <button
                        key={id}
                        onClick={() => setView(id)}
                        title={label}
                        className={`w-8 rounded-[4px] flex items-center justify-center transition-colors ${
                          view === id ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-200'
                        }`}
                      >
                        <Icon size={15} />
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {projects === null && <SkeletonGrid />}

              {projects && shown.length === 0 && (
                <div className="py-16 text-center">
                  <p className="text-[14px] text-slate-300">No recordings match “{query}”.</p>
                  <button onClick={() => setQuery('')} className="mt-2 text-[12.5px] text-indigo-400 hover:text-indigo-300">
                    Clear search
                  </button>
                </div>
              )}

              {view === 'grid' ? (
                <div className="grid gap-x-5 gap-y-7 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]">
                  {shown.map((p) => (
                    <article key={p.id} className="group min-w-0">
                      <button
                        onClick={() => openEditor(p.id)}
                        className="relative block w-full aspect-video rounded-[10px] overflow-hidden ring-1 ring-white/[0.06] hover:ring-indigo-500/70 shadow-[0_8px_24px_rgba(0,0,0,0.35)] transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                        title="Open in editor"
                      >
                        <Thumbnail id={p.id} className="absolute inset-0" />
                        <span className="absolute inset-0 bg-black/0 group-hover:bg-black/35 transition-colors" />
                        <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <span className="w-11 h-11 rounded-full bg-white/95 text-slate-900 flex items-center justify-center shadow-lg">
                            <PlayIcon size={18} className="ml-0.5" />
                          </span>
                        </span>
                        <span className="absolute left-2 top-2 flex gap-1">
                          {aspectLabel(p.width, p.height) && <Badge title="Canvas size">{aspectLabel(p.width, p.height)}</Badge>}
                          {p.hasWebcam && (
                            <Badge title="Has camera">
                              <CameraIcon size={11} />
                            </Badge>
                          )}
                          {(p.captionCount > 0 || p.hasTranscript) && (
                            <Badge title={p.captionCount > 0 ? `${p.captionCount} captions` : 'Transcribed'}>
                              <CaptionsIcon size={11} />
                            </Badge>
                          )}
                        </span>
                        <span className="absolute right-2 bottom-2">
                          <Badge>{formatDuration(p.duration)}</Badge>
                        </span>
                      </button>
                      <div className="flex items-start gap-1 mt-2.5">
                        <div className="flex-1 min-w-0">
                          {renaming?.id === p.id ? (
                            <RenameInput
                              value={renaming.value}
                              onChange={(value) => setRenaming({ id: p.id, value })}
                              onCommit={commitRename}
                              onCancel={() => setRenaming(null)}
                              className="w-full"
                            />
                          ) : (
                            <button
                              onClick={() => openEditor(p.id)}
                              onDoubleClick={(e) => {
                                e.preventDefault();
                                rename(p);
                              }}
                              title={p.name}
                              className="block max-w-full truncate text-left text-[13.5px] font-medium text-slate-100 hover:text-white"
                            >
                              {p.name}
                            </button>
                          )}
                          <div className="mt-0.5 text-[12px] text-slate-500 truncate">
                            {relativeTime(p.createdAt)} · {p.zoomCount} zoom{p.zoomCount === 1 ? '' : 's'}
                          </div>
                        </div>
                        <ProjectMenu project={p} onOpen={() => openEditor(p.id)} onRename={() => rename(p)} onDelete={() => setConfirmDelete(p)} />
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                shown.length > 0 && (
                  <div className="rounded-[10px] border border-slate-800 overflow-hidden">
                    <div className="grid grid-cols-[1fr_90px_80px_150px_40px] gap-4 px-4 h-9 items-center bg-slate-900 text-[11px] font-medium uppercase tracking-[0.06em] text-slate-500">
                      <span>Name</span>
                      <span>Length</span>
                      <span>Zooms</span>
                      <span>Recorded</span>
                      <span />
                    </div>
                    {shown.map((p) => (
                      <div
                        key={p.id}
                        onClick={() => renaming?.id !== p.id && openEditor(p.id)}
                        className="group grid grid-cols-[1fr_90px_80px_150px_40px] gap-4 px-4 py-2 items-center border-t border-slate-800/80 hover:bg-slate-900/70 cursor-pointer"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <Thumbnail id={p.id} className="relative w-[88px] aspect-video rounded-[5px] shrink-0 ring-1 ring-white/[0.06]" />
                          {renaming?.id === p.id ? (
                            <RenameInput
                              value={renaming.value}
                              onChange={(value) => setRenaming({ id: p.id, value })}
                              onCommit={commitRename}
                              onCancel={() => setRenaming(null)}
                              className="flex-1"
                            />
                          ) : (
                            <span className="truncate text-[13px] font-medium text-slate-100">{p.name}</span>
                          )}
                        </div>
                        <span className="text-[12.5px] text-slate-400 tabular-nums">{formatDuration(p.duration)}</span>
                        <span className="text-[12.5px] text-slate-400 tabular-nums">{p.zoomCount}</span>
                        <span className="text-[12.5px] text-slate-400" title={new Date(p.createdAt).toLocaleString()}>
                          {relativeTime(p.createdAt)}
                        </span>
                        <span onClick={(e) => e.stopPropagation()}>
                          <ProjectMenu project={p} onOpen={() => openEditor(p.id)} onRename={() => rename(p)} onDelete={() => setConfirmDelete(p)} />
                        </span>
                      </div>
                    ))}
                  </div>
                )
              )}
            </>
          )}

          <p className="flex items-center gap-1.5 text-[11.5px] text-slate-600 mt-12">
            <LockIcon size={12} />
            Recordings stay on this computer in Documents\Frame Studio. Deleting a project moves it to the Recycle Bin.
          </p>
        </div>
      </main>

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete “${confirmDelete.name}”?`}
          body="The project and its media move to the Recycle Bin, so you can restore them from there."
          confirm="Delete"
          onConfirm={() => deleteProject(confirmDelete.id)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

function EmptyState({ onRecord, onImport }) {
  return (
    <div className="mt-6 rounded-[14px] border border-slate-800 bg-[radial-gradient(80%_120%_at_50%_0%,rgba(38,128,235,0.12)_0%,transparent_60%)] px-8 py-20 text-center">
      <LogoMark size={56} className="mx-auto drop-shadow-lg" />
      <h1 className="mt-5 text-[20px] font-semibold tracking-tight text-slate-50">Make your first recording</h1>
      <p className="mt-2 max-w-[420px] mx-auto text-[13.5px] leading-relaxed text-slate-400">
        Record your screen, and Frame Studio adds smooth zooms, a polished background and a clean cursor for you.
      </p>
      <div className="mt-7 flex items-center justify-center gap-2.5">
        <button onClick={onRecord} className="ff-record-btn rounded-[7px] h-10 pl-4 pr-5 text-[13.5px]">
          <RecordIcon size={17} />
          New recording
        </button>
        <button onClick={onImport} className="h-10 px-4 rounded-[7px] flex items-center gap-2 border border-slate-700 hover:border-slate-500 text-[13.5px] text-slate-200">
          <UploadIcon size={15} /> Import a video
        </button>
      </div>
      <p className="mt-5 text-[12px] text-slate-500">
        Tip: press <kbd className="px-1.5 py-0.5 rounded border border-slate-700 text-[11px] font-sans">Ctrl+Alt+R</kbd> anywhere to start and stop.
      </p>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid gap-x-5 gap-y-7 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i}>
          <div className="aspect-video rounded-[10px] bg-slate-900 animate-pulse" />
          <div className="mt-3 h-3.5 w-2/3 rounded bg-slate-900 animate-pulse" />
          <div className="mt-2 h-3 w-1/3 rounded bg-slate-900 animate-pulse" />
        </div>
      ))}
    </div>
  );
}

function ConfirmDialog({ title, body, confirm, onConfirm, onCancel }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="w-[400px] rounded-[10px] border border-black/70 bg-slate-900 p-5 shadow-[0_24px_60px_rgba(0,0,0,0.6)]">
        <h2 className="text-[15px] font-semibold text-slate-50 break-words">{title}</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-slate-400">{body}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} className="h-8 px-3.5 rounded-[6px] text-[13px] text-slate-300 hover:bg-slate-800">
            Cancel
          </button>
          <button autoFocus onClick={onConfirm} className="h-8 px-4 rounded-[6px] bg-red-600 hover:bg-red-500 text-[13px] font-semibold text-white">
            {confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
