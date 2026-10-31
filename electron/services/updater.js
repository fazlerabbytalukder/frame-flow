// App updates from GitHub Releases (github.com/fazlerabbytalukder/frame-flow),
// through electron-updater. This is the app's only outgoing connection: it
// asks GitHub for the latest release's latest.yml and, only when the user
// clicks Download, fetches the installer. No recording, project or usage data
// is ever sent. The feed is fixed in package.json ("publish").
//
// Flow: check (at startup, then every few hours) → 'available' notice →
// user clicks Download → 'downloading' with progress → 'ready' → user clicks
// Restart (refused while recording), or it installs when the app next quits.
// Installed builds only; `npm start` / tests report 'disabled'.

const CHECK_DELAY_MS = 15 * 1000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

// `updater` is electron-updater's autoUpdater (injected so tests can fake it).
function createUpdater({ updater, enabled, isBusy, broadcast, log = () => {} }) {
  let state = { status: enabled ? 'idle' : 'disabled', version: null, percent: 0, notes: '', error: null };
  let timers = [];

  const set = (patch) => {
    state = { ...state, ...patch };
    broadcast(state);
  };

  if (enabled) {
    updater.autoDownload = false; // the user decides when to download
    updater.autoInstallOnAppQuit = true;
    updater.on('checking-for-update', () => set({ status: 'checking', error: null }));
    updater.on('update-not-available', () => set({ status: 'none' }));
    updater.on('update-available', (info) =>
      set({ status: 'available', version: info.version, notes: notesText(info.releaseNotes), percent: 0 })
    );
    updater.on('download-progress', (p) => set({ status: 'downloading', percent: Math.round(p.percent || 0) }));
    updater.on('update-downloaded', (info) => set({ status: 'ready', version: info.version, percent: 100 }));
    updater.on('error', (err) => {
      log(`update error: ${err && err.stack ? err.stack : err}`);
      // A failed check is quiet (offline is normal); a failed download is shown.
      set({ status: state.status === 'downloading' ? 'error' : 'idle', error: friendlyError(err) });
    });
  }

  async function check() {
    if (!enabled || state.status === 'downloading' || state.status === 'ready') return state;
    try {
      await updater.checkForUpdates();
    } catch (err) {
      // Reported through the 'error' event.
    }
    return state;
  }

  async function download() {
    if (!enabled || (state.status !== 'available' && state.status !== 'error') || !state.version) return state;
    set({ status: 'downloading', percent: 0, error: null });
    try {
      await updater.downloadUpdate();
    } catch (err) {
      // Reported through the 'error' event.
    }
    return state;
  }

  function install() {
    if (!enabled || state.status !== 'ready') return { ok: false, reason: 'No update is ready yet.' };
    if (isBusy()) return { ok: false, reason: 'Stop the recording first — the update restarts the app.' };
    // isSilent=false shows the installer's progress; isForceRunAfter reopens the app.
    setImmediate(() => updater.quitAndInstall(false, true));
    return { ok: true };
  }

  function start() {
    if (!enabled) return;
    timers.push(setTimeout(check, CHECK_DELAY_MS));
    timers.push(setInterval(check, CHECK_EVERY_MS));
  }

  function stop() {
    for (const t of timers) clearTimeout(t);
    timers = [];
  }

  return { getState: () => state, check, download, install, start, stop };
}

// GitHub release notes arrive as HTML (or a list of them); show plain text.
function notesText(notes) {
  const raw = Array.isArray(notes) ? notes.map((n) => n.note || '').join('\n') : String(notes || '');
  return raw
    .replace(/<\/(p|li|h\d)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 2000);
}

function friendlyError(err) {
  const msg = String((err && err.message) || err || '');
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::|ENETUNREACH|EAI_AGAIN/.test(msg)) return 'Could not reach GitHub. Check your internet connection.';
  if (/ENOSPC/.test(msg)) return 'Not enough disk space to download the update.';
  return 'The update could not be downloaded. Try again later.';
}

module.exports = { createUpdater, notesText, friendlyError, CHECK_DELAY_MS, CHECK_EVERY_MS };
