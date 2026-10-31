// App updates from GitHub Releases: the state machine around electron-updater
// (faked here, so nothing touches the network), the user-driven download, the
// restart that waits for a recording to end, and the fixed release feed.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const { suite, invoke } = require('./harness');
const { createUpdater, notesText, friendlyError } = require('../../electron/services/updater');

const ROOT = path.join(__dirname, '..', '..');

function fakeUpdater() {
  const u = new EventEmitter();
  u.calls = [];
  u.checkForUpdates = async () => u.calls.push('check');
  u.downloadUpdate = async () => u.calls.push('download');
  u.quitAndInstall = (...args) => u.calls.push(['quitAndInstall', ...args]);
  return u;
}

function make({ enabled = true, busy = false } = {}) {
  const updater = fakeUpdater();
  const seen = [];
  const flags = { busy };
  const updates = createUpdater({ updater, enabled, isBusy: () => flags.busy, broadcast: (s) => seen.push(s) });
  return { updater, updates, seen, flags };
}

const tick = () => new Promise((r) => setImmediate(r));

module.exports = () => {
  suite('App updates (GitHub Releases)', (test) => {
    test('dev and test builds never check, download or install', async () => {
      const { updater, updates } = make({ enabled: false });
      assert.equal(updates.getState().status, 'disabled');
      await updates.check();
      await updates.download();
      assert.equal(updates.install().ok, false);
      updates.start();
      updates.stop();
      assert.deepEqual(updater.calls, []);
      assert.equal(updater.listenerCount('update-available'), 0);
    });

    test('an available update waits for the user to download it', async () => {
      const { updater, updates, seen } = make();
      assert.equal(updater.autoDownload, false, 'nothing downloads without a click');
      assert.equal(updater.autoInstallOnAppQuit, true);
      await updates.check();
      updater.emit('checking-for-update');
      updater.emit('update-available', { version: '0.2.0', releaseNotes: '<h2>New</h2><ul><li>Faster export &amp; GIFs</li></ul>' });
      const s = updates.getState();
      assert.equal(s.status, 'available');
      assert.equal(s.version, '0.2.0');
      assert.equal(s.notes, 'New\nFaster export & GIFs');
      assert.deepEqual(updater.calls, ['check']);
      assert.equal(seen[seen.length - 1].status, 'available', 'windows hear every change');
    });

    test('download shows progress, then restart installs — never mid-recording', async () => {
      const { updater, updates, flags } = make({ busy: true });
      assert.equal(updates.install().ok, false, 'nothing to install yet');
      await updates.download();
      assert.deepEqual(updater.calls, [], 'no download before an update was found');

      updater.emit('update-available', { version: '0.2.0' });
      await updates.download();
      updater.emit('download-progress', { percent: 41.6 });
      assert.deepEqual([updates.getState().status, updates.getState().percent], ['downloading', 42]);
      await updates.check();
      assert.deepEqual(updater.calls, ['download'], 'no re-check while downloading');
      updater.emit('update-downloaded', { version: '0.2.0' });
      assert.equal(updates.getState().status, 'ready');

      const refused = updates.install();
      assert.equal(refused.ok, false);
      assert.match(refused.reason, /recording/i);
      await tick();
      assert.equal(updater.calls.length, 1, 'no restart while recording');

      flags.busy = false;
      assert.equal(updates.install().ok, true);
      await tick();
      assert.deepEqual(updater.calls[1], ['quitAndInstall', false, true]);
    });

    test('a failed check stays quiet; a failed download can be retried', async () => {
      const { updater, updates } = make();
      updater.emit('checking-for-update');
      updater.emit('error', new Error('getaddrinfo ENOTFOUND github.com'));
      assert.equal(updates.getState().status, 'idle', 'being offline is not an alarm');

      updater.emit('update-available', { version: '0.3.0' });
      await updates.download();
      updater.emit('error', new Error('net::ERR_CONNECTION_RESET'));
      assert.equal(updates.getState().status, 'error');
      assert.match(updates.getState().error, /internet/);
      await updates.download();
      assert.deepEqual(updater.calls, ['download', 'download']);
    });

    test('helpers: release notes become plain text; errors become plain words', () => {
      assert.equal(notesText([{ note: '<p>A</p>' }, { note: '<p>B</p>' }]), 'A\n\nB');
      assert.equal(notesText(null), '');
      assert.ok(notesText('x'.repeat(5000)).length <= 2000);
      assert.match(friendlyError(new Error('ENOSPC: no space')), /disk space/);
      assert.match(friendlyError(new Error('sha512 checksum mismatch')), /could not be downloaded/);
    });

    test('IPC exposes the state; the app is wired to the fixed GitHub feed', async () => {
      assert.equal((await invoke('update:state')).status, 'disabled');
      assert.equal((await invoke('update:install')).ok, false);

      const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
      assert.deepEqual(pkg.build.publish, [{ provider: 'github', owner: 'fazlerabbytalukder', repo: 'frame-flow', releaseType: 'release' }]);
      const main = fs.readFileSync(path.join(ROOT, 'electron', 'main.js'), 'utf8');
      assert.match(main, /enabled: app\.isPackaged/, 'updates only in installed builds');
      assert.match(main, /isBusy: isRecording/, 'restart waits for the recording to end');
    });
  });
};
