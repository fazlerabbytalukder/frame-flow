// Runs the packaged-app smoke test (tests/packaged/smoke.js) with a clean
// environment; see scripts/launch-electron.js for why ELECTRON_RUN_AS_NODE goes.
// Usage: npm run test:packaged [-- <path to win-unpacked>]
const path = require('path');
const { spawn } = require('child_process');

const electronPath = require('electron');

delete process.env.ELECTRON_RUN_AS_NODE;

const child = spawn(
  electronPath,
  [path.join(__dirname, 'packaged', 'smoke.js'), ...process.argv.slice(2)],
  { stdio: 'inherit', env: process.env }
);
child.on('close', (code) => process.exit(code ?? 1));
