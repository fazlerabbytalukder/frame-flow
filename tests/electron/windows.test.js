// Two-window shell IPC: the recorder bar asks the main process to open the
// library/editor and to toggle its click-through. Requests are validated before they
// reach the window callbacks (recorded in ctx.shellCalls).
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const { suite, invoke, rejects } = require('./harness');

module.exports = (ctx) => {
  suite('Window shell (IPC)', (test) => {
    const last = () => ctx.shellCalls[ctx.shellCalls.length - 1];

    test('open-main passes only validated targets', async () => {
      await invoke('app:open-main', { view: 'library', extra: 'dropped' });
      assert.deepEqual(last(), ['openMain', { view: 'library' }]);

      await invoke('app:open-main', { view: 'editor', projectId: 'abc-123' });
      assert.deepEqual(last(), ['openMain', { view: 'editor', projectId: 'abc-123' }]);

      const before = ctx.shellCalls.length;
      await rejects(invoke('app:open-main', null), /Invalid view/);
      await rejects(invoke('app:open-main', { view: 'settings' }), /Invalid view/);
      await rejects(invoke('app:open-main', { view: 'editor', projectId: '../x' }), /Invalid project id/);
      await rejects(invoke('app:open-main', { view: 'editor' }), /Invalid project id/);
      assert.equal(ctx.shellCalls.length, before);
    });

    test('hud:set-interactive accepts booleans only', async () => {
      await invoke('hud:set-interactive', true);
      assert.deepEqual(last(), ['setHudInteractive', null, true]);
      await invoke('hud:set-interactive', false);
      assert.deepEqual(last(), ['setHudInteractive', null, false]);
      await rejects(invoke('hud:set-interactive', 'yes'), /Invalid interactive flag/);
      await rejects(invoke('hud:set-interactive', 1), /Invalid interactive flag/);
    });

    test('recorder bar window calls reach the shell', async () => {
      await invoke('app:show-recorder');
      assert.deepEqual(last(), ['showRecorder']);
      await invoke('hud:minimize');
      assert.deepEqual(last(), ['minimizeHud', null]);
      await invoke('hud:close');
      assert.deepEqual(last(), ['closeHud', null]);
    });

    test('the recorder bar is excluded from capture, never resizes, and starts click-through', () => {
      const main = fs.readFileSync(path.join(__dirname, '..', '..', 'electron', 'main.js'), 'utf8');
      assert.match(main, /hudWindow\.setContentProtection\(true\)/);
      assert.match(main, /hudWindow\.setIgnoreMouseEvents\(true, \{ forward: true \}\)/);
      // Resizing a transparent window flashes on Windows.
      assert.doesNotMatch(main, /hudWindow\.(setBounds|setSize)\(/);
      const hud = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'features', 'hud', 'RecorderHud.jsx'),
        'utf8'
      );
      assert.match(hud, /hud\.setInteractive\(/);
    });
  });
};
