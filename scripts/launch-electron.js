// Launches Electron with a clean environment. IDE terminals (VS Code) export
// ELECTRON_RUN_AS_NODE=1, which makes the Electron binary behave like plain
// Node and breaks the app; cross-env can only set it to "", not remove it, so
// we delete it here before spawning.
const { spawn } = require('child_process');

const electronPath = require('electron'); // path string when required from plain Node

delete process.env.ELECTRON_RUN_AS_NODE;
if (process.argv.includes('--dev')) process.env.FRAMEFLOW_DEV = '1';

const child = spawn(electronPath, ['.'], { stdio: 'inherit', env: process.env });
child.on('close', (code) => process.exit(code ?? 0));
