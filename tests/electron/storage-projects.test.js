// Storage, project schema, persistence round-trips, library management, themes.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { shell } = require('electron');

const storage = require('../../electron/services/storage');
const {
  validateProject, createProjectDocument, makeTheme, themeFromFile, themeFileContents,
} = require('../../electron/ipc/projects');
const { suite, invoke, rejects } = require('./harness');
const { makeProject } = require('./fixtures');

module.exports = (ctx) => {
  suite('Storage', (test) => {
    test('project ids are restricted to [a-z0-9-]', () => {
      for (const bad of ['', '../x', 'A', 'a/b', 'a\\b', 'x'.repeat(65), null, 42, 'con..']) {
        assert.throws(() => storage.assertProjectId(bad), /Invalid project id/, String(bad));
      }
      assert.equal(storage.assertProjectId('rec-2026-01-01-abcd'), 'rec-2026-01-01-abcd');
    });

    test('assertInsideBase rejects paths outside Documents/Frame Studio', () => {
      const base = storage.baseDir();
      assert.throws(() => storage.assertInsideBase(path.join(base, '..', 'evil.txt')));
      assert.throws(() => storage.assertInsideBase(base + '-sibling'));
      assert.throws(() => storage.assertInsideBase('C:\\Windows\\win.ini'));
      assert.equal(storage.assertInsideBase(path.join(base, 'projects')), path.join(base, 'projects'));
    });

    test('writeJsonAtomic writes valid JSON and leaves no temp file', () => {
      const file = path.join(storage.baseDir(), 'atomic.json');
      storage.writeJsonAtomic(file, { a: 1 });
      storage.writeJsonAtomic(file, { a: 2, nested: [1, 2] });
      assert.deepEqual(storage.readJson(file), { a: 2, nested: [1, 2] });
      assert.equal(fs.existsSync(file + '.tmp'), false);
    });

    test('newProjectId is valid and unique', () => {
      const ids = new Set(Array.from({ length: 200 }, () => storage.newProjectId()));
      for (const id of ids) storage.assertProjectId(id);
      assert.ok(ids.size > 190);
    });
  });

  suite('Project schema', (test) => {
    const base = () =>
      createProjectDocument({ projectId: 'rec-schema', duration: 5, sourceName: 'S', hasWebcam: true, cursorHidden: false });

    test('a freshly created document validates', () => {
      const p = validateProject(base());
      assert.equal(p.clips[0].duration, 5);
      assert.equal(p.style.webcam.enabled, true);
      assert.equal(p.style.cursor.overlay, false);
      assert.ok(p.assets.some((a) => a.type === 'webcam-recording'));
    });

    test('old schema-1 projects get defaults for newer fields', () => {
      const p = base();
      delete p.captions;
      delete p.annotations;
      delete p.style.volume;
      delete p.style.crop;
      delete p.style.clipTransition;
      delete p.style.cursor;
      delete p.clips[0].speed;
      const v = validateProject(p);
      assert.deepEqual(v.captions, []);
      assert.deepEqual(v.annotations, []);
      assert.equal(v.style.volume, 1);
      assert.deepEqual(v.style.crop, { l: 0, r: 0, t: 0, b: 0 });
      assert.equal(v.style.clipTransition.type, 'none');
      assert.equal(v.clips[0].speed, 1);
    });

    test('animation defaults: new projects use springs + blur, old ones keep their look', () => {
      const fresh = validateProject(base());
      assert.equal(fresh.style.animation.screen, 'focused');
      assert.equal(fresh.style.animation.motionBlur.strength, 0.5);
      assert.equal(fresh.style.shortcuts.enabled, true);
      assert.equal(fresh.style.cursor.animation, 'medium');

      const old = base();
      delete old.style.animation;
      delete old.style.shortcuts;
      delete old.style.cursor.animation;
      const v = validateProject(old);
      assert.equal(v.style.animation.screen, 'classic');
      assert.equal(v.style.animation.motionBlur.strength, 0);
      assert.equal(v.style.cursor.animation, 'medium');

      const bad = base();
      bad.style.animation = { screen: '<script>', motionBlur: { strength: 7, zoom: false } };
      bad.style.cursor.animation = 'warp';
      const b = validateProject(bad);
      assert.equal(b.style.animation.screen, 'classic');
      assert.equal(b.style.animation.motionBlur.strength, 1);
      assert.equal(b.style.animation.motionBlur.zoom, false);
      assert.equal(b.style.cursor.animation, 'medium');
    });

    test('zoom style: classic for new and old projects, loupe kept, junk reset', () => {
      assert.equal(validateProject(base()).style.zoomStyle, 'classic');
      const old = base();
      delete old.style.zoomStyle;
      assert.equal(validateProject(old).style.zoomStyle, 'classic');
      const loupe = base();
      loupe.style.zoomStyle = 'loupe';
      assert.equal(validateProject(loupe).style.zoomStyle, 'loupe');
      const bad = base();
      bad.style.zoomStyle = '<img>';
      assert.equal(validateProject(bad).style.zoomStyle, 'classic');
    });

    test('clip transitions: per-cut choices are validated, junk is dropped', () => {
      const p = base();
      p.style.clipTransition = { type: 'wipe', duration: 5 };
      p.clips = [
        { ...p.clips[0], id: 'a' },
        { ...p.clips[0], id: 'b', transition: { type: 'zoom', duration: 0.8, extra: 1 } },
        { ...p.clips[0], id: 'c', transition: { type: '<script>' } },
        { ...p.clips[0], id: 'd', transition: 'slide' },
      ];
      const v = validateProject(p);
      assert.deepEqual(v.style.clipTransition, { type: 'wipe', duration: 2 });
      assert.deepEqual(v.clips[1].transition, { type: 'zoom', duration: 0.8 });
      assert.equal(v.clips[2].transition, undefined);
      assert.equal(v.clips[3].transition, undefined);
      const bad = base();
      bad.style.clipTransition = { type: 'explode' };
      assert.equal(validateProject(bad).style.clipTransition.type, 'none');
    });

    test('screen framing: auto by default, fit/fill kept, junk reset', () => {
      assert.equal(validateProject(base()).style.framing, 'auto');
      for (const f of ['fit', 'fill']) {
        const p = base();
        p.style.framing = f;
        assert.equal(validateProject(p).style.framing, f);
      }
      const bad = base();
      bad.style.framing = 'stretch';
      assert.equal(validateProject(bad).style.framing, 'auto');
    });

    test('out-of-range values are clamped', () => {
      const p = base();
      p.style.volume = 9;
      p.clips[0].speed = 50;
      const v = validateProject(p);
      assert.equal(v.style.volume, 2);
      assert.equal(v.clips[0].speed, 1);
    });

    test('malformed documents are rejected', () => {
      const cases = [
        [(p) => { p.schemaVersion = 2; }, /schema version/],
        [(p) => { p.id = '../evil'; }, /project id/],
        [(p) => { p.assets[0].path = '../../secret'; }, /relative/],
        [(p) => { p.assets[0].path = 'C:\\Windows\\win.ini'; }, /relative/],
        [(p) => { p.zoomEvents = [{ time: 0, duration: NaN, x: 0, y: 0, scale: 2 }]; }, /zoom/],
        [(p) => { p.captions = [{ text: 'x'.repeat(501), time: 0, duration: 1 }]; }, /caption/],
        [(p) => { p.annotations = [{ type: 'script', time: 0, duration: 1, x: 0, y: 0 }]; }, /annotation/],
        [(p) => { p.annotations = [{ type: 'text', time: 0, duration: 1, x: 0, y: 0, text: 5 }]; }, /annotation/],
        [(p) => { p.style.backgroundImage = '..\\..\\x.png'; }, /background/],
        [(p) => { p.clips = null; }, /collections/],
        [(p) => { delete p.project; }, /metadata/],
        [(p) => { p.layouts = [{ time: 0, duration: 1, layout: 'hologram' }]; }, /camera layout/],
        [(p) => { p.layouts = [{ time: 'x', duration: 1, layout: 'split' }]; }, /camera layout/],
        [(p) => { p.audioAnalysis = { silences: [{ start: 'a', end: 2 }] }; }, /audio analysis/],
        [(p) => { p.audioAnalysis = { silences: 'nope' }; }, /audio analysis/],
        [(p) => { p.zoomEvents = [{ time: 0, duration: 1, x: 0, y: 0, scale: 2, type: 'warp' }]; }, /zoom type/],
      ];
      for (const [mutate, re] of cases) {
        const p = base();
        mutate(p);
        assert.throws(() => validateProject(p), re);
      }
      assert.throws(() => validateProject(null));
      assert.throws(() => validateProject('{}'));
    });

    test('all five camera layouts are valid blocks', () => {
      const p = base();
      p.layouts = ['camera', 'split', 'overlay', 'screen', 'cutout'].map((layout, i) => ({
        id: `l${i}`, time: i * 2, duration: 2, layout,
      }));
      assert.deepEqual(validateProject(p).layouts.map((l) => l.layout), ['camera', 'split', 'overlay', 'screen', 'cutout']);
    });
  });

  suite('Projects IPC (persistence + library)', (test) => {
    test('a saved project reopens with every edit preserved', async () => {
      const p = await makeProject(ctx, { seconds: 3 });
      const edited = await invoke('projects:load', p.id);
      edited.clips = [
        { ...edited.clips[0], duration: 1.5, speed: 2 },
        { id: 'clip-2', assetId: 'screen-1', start: 1.5, duration: 1.4, speed: 0.5 },
      ];
      edited.zoomEvents.push({ id: 'z1', time: 0.5, duration: 2, x: 0.3, y: 0.7, scale: 2.2, transition: 0.4 });
      edited.captions.push({ id: 'c1', text: 'Hello world', time: 0, duration: 1 });
      edited.annotations.push({ id: 'a1', type: 'arrow', time: 1, duration: 1, x: 0.1, y: 0.2, x2: 0.4, y2: 0.5, color: '#ef4444' });
      Object.assign(edited.style, {
        background: 'gradient-3', padding: 0.12, cornerRadius: 30, volume: 0.4,
        crop: { l: 0.1, r: 0, t: 0.05, b: 0 }, clipTransition: { type: 'fade', duration: 0.6 },
      });
      edited.project.width = 1080;
      edited.project.height = 1920;
      const res = await invoke('projects:save', structuredClone(edited));
      assert.equal(res.ok, true);

      const reopened = await invoke('projects:load', p.id);
      for (const key of ['clips', 'zoomEvents', 'captions', 'annotations', 'style', 'project']) {
        assert.deepEqual(reopened[key], edited[key], key);
      }
      assert.notEqual(reopened.updatedAt, p.updatedAt);
    });

    test('list returns valid projects and skips corrupt or stray folders', async () => {
      const good = await makeProject(ctx, { seconds: 2 });
      const corruptDir = path.join(storage.projectsDir(), 'rec-corrupt');
      fs.mkdirSync(corruptDir, { recursive: true });
      fs.writeFileSync(path.join(corruptDir, 'project.json'), '{ not json');
      fs.mkdirSync(path.join(storage.projectsDir(), 'Not A Valid Id'), { recursive: true });
      fs.writeFileSync(path.join(storage.projectsDir(), 'loose-file.txt'), 'x');

      const list = await invoke('projects:list');
      assert.ok(list.some((x) => x.id === good.id && x.name === 'Fixture screen'));
      assert.ok(!list.some((x) => x.id === 'rec-corrupt'));
      assert.ok(fs.existsSync(corruptDir), 'corrupt projects must never be deleted');
      for (let i = 1; i < list.length; i++) assert.ok(list[i - 1].createdAt >= list[i].createdAt);
    });

    test('rename validates and persists the name', async () => {
      const p = await makeProject(ctx, { seconds: 2 });
      await rejects(invoke('projects:rename', p.id, '   '), /Invalid project name/);
      await rejects(invoke('projects:rename', p.id, 'x'.repeat(121)), /Invalid project name/);
      const r = await invoke('projects:rename', p.id, '  Demo v2  ');
      assert.equal(r.name, 'Demo v2');
      assert.equal((await invoke('projects:load', p.id)).project.name, 'Demo v2');
    });

    test('delete moves the project to the Recycle Bin', async () => {
      const p = await makeProject(ctx, { seconds: 2 });
      const trashed = [];
      const original = shell.trashItem;
      // Stubbed so the test never fills the real Recycle Bin.
      shell.trashItem = async (dir) => {
        trashed.push(dir);
        fs.rmSync(dir, { recursive: true, force: true });
      };
      try {
        await invoke('projects:delete', p.id);
        await invoke('projects:delete', p.id); // already gone: still ok
      } finally {
        shell.trashItem = original;
      }
      assert.deepEqual(trashed, [storage.projectDir(p.id)]);
      await rejects(invoke('projects:load', p.id));
    });

    test('media-url resolves existing media only', async () => {
      const p = await makeProject(ctx, { seconds: 2 });
      assert.equal(await invoke('projects:media-url', p.id, 'media/screen.webm'), `frameflow-media://${p.id}/media/screen.webm`);
      await rejects(invoke('projects:media-url', p.id, 'media/nope.webm'), /not found/);
    });

    test('read-cursor returns the recorded track', async () => {
      const p = await makeProject(ctx, { seconds: 2 });
      const track = await invoke('projects:read-cursor', p.id);
      assert.equal(track.samples.length, 120);
      assert.equal(track.clicks.length, 1);
    });

    test('theme files round-trip and untrusted files are validated', () => {
      const theme = makeTheme(' Team look ', {
        background: 'gradient-4', shadowStyle: { angle: 45 }, inset: { size: 0.01 }, music: { path: 'x' },
      });
      assert.deepEqual(Object.keys(theme.style).sort(), ['background', 'inset', 'shadowStyle']);
      const back = themeFromFile(JSON.parse(JSON.stringify(themeFileContents(theme))));
      assert.deepEqual(back, theme);
      assert.throws(() => themeFromFile({ name: 'x', style: {} }), /Not a Frame Studio theme/);
      assert.throws(() => themeFromFile({ format: 'frameflow-theme', version: 2, name: 'x', style: {} }), /Not a Frame Studio theme/);
      assert.throws(() => themeFromFile({ format: 'frameflow-theme', version: 1, name: '', style: {} }), /theme name/);
      assert.throws(() => themeFromFile({ format: 'frameflow-theme', version: 1, name: 'x', style: [] }), /theme style/);
      // Project media never travels in a theme.
      assert.equal(makeTheme('x', { background: 'image' }).style.background, undefined);
    });

    test('themes store only style fields and can be deleted', async () => {
      const themes = await invoke('themes:save', ' Brand ', {
        background: 'gradient-2', padding: 0.1, cornerRadius: 12, shadow: false, volume: 2, crop: { l: 0.4 },
      });
      const t = themes.find((x) => x.name === 'Brand');
      assert.deepEqual(Object.keys(t.style).sort(), ['background', 'cornerRadius', 'padding', 'shadow']);
      await invoke('themes:save', 'Brand', { padding: 0.2 }); // overwrite, not duplicate
      assert.equal((await invoke('themes:list')).filter((x) => x.name === 'Brand').length, 1);
      await rejects(invoke('themes:save', '', {}), /theme name/);
      await rejects(invoke('themes:save', 'x', null), /theme style/);
      assert.equal((await invoke('themes:delete', 'Brand')).some((x) => x.name === 'Brand'), false);
    });

    test('presets carry camera, zoom style, framing and canvas size; update in place; rename', async () => {
      await invoke('themes:save', 'First', { padding: 0.05 });
      let list = await invoke('themes:save', 'TikTok', {
        webcam: { enabled: true, shape: 'circle', position: 'bottom-left' }, zoomStyle: 'loupe', framing: 'fill',
        backgroundImage: 'media/x.png',
      }, { width: 1080, height: 1920 });
      let t = list.find((x) => x.name === 'TikTok');
      assert.deepEqual(Object.keys(t.style).sort(), ['framing', 'webcam', 'zoomStyle']);
      assert.deepEqual(t.canvas, { width: 1080, height: 1920 });
      const at = list.findIndex((x) => x.name === 'TikTok');

      // Bad canvas sizes are dropped, not saved.
      list = await invoke('themes:save', 'Odd', { padding: 0.1 }, { width: 99999, height: 'x' });
      assert.equal(list.find((x) => x.name === 'Odd').canvas, undefined);

      // Updating keeps its number in the list.
      list = await invoke('themes:save', 'TikTok', { zoomStyle: 'classic' }, { width: 1080, height: 1350 });
      assert.equal(list.findIndex((x) => x.name === 'TikTok'), at);
      assert.deepEqual(list[at].canvas, { width: 1080, height: 1350 });

      list = await invoke('themes:rename', 'TikTok', ' Reels ');
      assert.equal(list[at].name, 'Reels');
      assert.equal(list[at].style.zoomStyle, 'classic');
      await rejects(invoke('themes:rename', 'Reels', 'First'), /already exists/);
      await rejects(invoke('themes:rename', 'Nope', 'X'), /not found/);
      await rejects(invoke('themes:rename', 'Reels', ''), /theme name/);

      // Canvas size travels in shared files too.
      const file = themeFileContents(list[at]);
      assert.deepEqual(themeFromFile(JSON.parse(JSON.stringify(file))).canvas, { width: 1080, height: 1350 });
      for (const n of ['First', 'Reels', 'Odd']) await invoke('themes:delete', n);
    });

    test('background and frame options are validated and survive a save', async () => {
      const p = await makeProject(ctx, { seconds: 2 });
      const edited = await invoke('projects:load', p.id);
      Object.assign(edited.style, {
        background: 'gradient', backgroundGradient: { from: '#112233', to: '#445566', angle: 400 },
        backgroundColor: '#abcdef', backgroundBlur: 0.4, paddingY: 0.2, frameless: true,
        backgroundVideo: 'media/background-video-1.mp4',
      });
      await invoke('projects:save', structuredClone(edited));
      const st = (await invoke('projects:load', p.id)).style;
      assert.deepEqual(st.backgroundGradient, { from: '#112233', to: '#445566', angle: 40 });
      assert.equal(st.backgroundColor, '#abcdef');
      assert.equal(st.backgroundBlur, 0.4);
      assert.equal(st.paddingY, 0.2);
      assert.equal(st.frameless, true);

      // Hostile or broken values are repaired or refused.
      const bad = structuredClone(edited);
      Object.assign(bad.style, {
        backgroundColor: 'red; background:url(x)', backgroundGradient: { from: 'nope', angle: 'x' },
        backgroundBlur: 9, paddingY: -1, frameless: 'yes',
      });
      const fixed = validateProject(bad).style;
      assert.equal(fixed.backgroundColor, '#2a2a2a');
      assert.deepEqual(fixed.backgroundGradient, { from: '#1473e6', to: '#0b2a52', angle: 135 });
      assert.equal(fixed.backgroundBlur, 1);
      assert.equal(fixed.paddingY, 0);
      assert.equal(fixed.frameless, false);
      for (const evil of ['../../evil.mp4', 'C:\\evil.mp4']) {
        const e = structuredClone(edited);
        e.style.backgroundVideo = evil;
        assert.throws(() => validateProject(e), /background media path/);
      }
    });

    test('new recordings are marked for auto zoom; presets carry the new looks but never media', () => {
      const doc = createProjectDocument({ projectId: 'rec-auto', duration: 3 });
      assert.deepEqual(doc.autoZoom, { pending: true });
      const t = makeTheme('Look', {
        background: 'wall-dusk', backgroundBlur: 0.3, paddingY: 0.1, frameless: true,
        backgroundColor: '#000000', backgroundGradient: { from: '#000000', to: '#ffffff', angle: 90 },
        backgroundImage: 'media/bg.png', backgroundVideo: 'media/v.mp4',
      });
      assert.deepEqual(Object.keys(t.style).sort(), [
        'background', 'backgroundBlur', 'backgroundColor', 'backgroundGradient', 'frameless', 'paddingY',
      ]);
      assert.equal(makeTheme('x', { background: 'video' }).style.background, undefined);
    });
  });
};
