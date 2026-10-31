// Runs the Electron-side integration suite (tests/electron/main.js) with a
// clean environment. IDE terminals export ELECTRON_RUN_AS_NODE=1, which turns
// Electron into plain Node; see scripts/launch-electron.js.
const path = require('path');
const { spawn } = require('child_process');

const electronPath = require('electron');

delete process.env.ELECTRON_RUN_AS_NODE;

const child = spawn(
  electronPath,
  [path.join(__dirname, 'electron', 'main.js'), ...process.argv.slice(2)],
  { stdio: 'inherit', env: process.env }
);
child.on('close', (code) => process.exit(code ?? 1));
