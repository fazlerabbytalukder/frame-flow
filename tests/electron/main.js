// Electron integration suite entry point. Run with `npm run test:electron`.
//
// Everything runs against a throwaway Documents folder, so a Frame Studio
// instance the user has open (and their real library) is never touched.
// Flags: --keep keeps the temp folder for inspection; --only=<text> runs the
// suites whose name contains <text>.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'frameflow-test-'));
app.setPath('documents', path.join(tmpRoot, 'Documents'));
app.setPath('userData', path.join(tmpRoot, 'userData'));

// The harness must load before the IPC modules so it captures their handlers.
const harness = require('./harness');
const storage = require('../../electron/services/storage');
const { registerProjectsIpc } = require('../../electron/ipc/projects');
const { registerRecordingIpc } = require('../../electron/ipc/recording');
const { registerExportIpc } = require('../../electron/ipc/export');
const { registerWindowsIpc } = require('../../electron/ipc/windows');
const { registerTranscriptIpc } = require('../../electron/ipc/transcript');
const { registerToolsIpc } = require('../../electron/ipc/tools');

const keep = process.argv.includes('--keep');
const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).toLowerCase();

app.whenReady().then(async () => {
  let failed = 1;
  try {
    storage.ensureBaseDirs();
    registerProjectsIpc();
    registerRecordingIpc(() => null);
    registerExportIpc(() => null);
    registerTranscriptIpc();
    registerToolsIpc();
    // Window calls are recorded instead of touching real windows.
    const shellCalls = [];
    registerWindowsIpc(
      Object.fromEntries(
        ['openMain', 'showRecorder', 'setHudInteractive', 'minimizeHud', 'closeHud'].map((name) => [
          name,
          (...args) => shellCalls.push([name, ...args]),
        ])
      )
    );

    const ctx = { tmpRoot, fixturesDir: path.join(tmpRoot, 'fixtures'), shellCalls };
    fs.mkdirSync(ctx.fixturesDir, { recursive: true });

    for (const file of [
      'storage-projects.test.js',
      'recording-recovery.test.js',
      'native-capture.test.js',
      'export.test.js',
      'visual.test.js',
      'segmenter.test.js',
      'studio-features.test.js',
      'windows.test.js',
      'security.test.js',
    ]) {
      require(`./${file}`)(ctx);
    }

    console.log(`Frame Studio integration tests (data root: ${tmpRoot})`);
    failed = await harness.runAll({ filter: only });
  } catch (err) {
    console.error('Harness crashed:', err);
  } finally {
    if (!keep) {
      try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
    } else {
      console.log(`Kept test data at ${tmpRoot}`);
    }
    app.exit(failed ? 1 : 0);
  }
});

app.on('window-all-closed', () => {
  // Keep running while hidden test windows come and go.
});
