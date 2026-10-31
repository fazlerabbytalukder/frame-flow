// Minimal test harness for the Electron main process (node:test's reporter
// does not play well with app lifecycle). Suites register with `suite()`;
// `runAll()` executes them in order and returns the failure count.
const { ipcMain } = require('electron');

const suites = [];

function suite(name, fn) {
  const tests = [];
  fn((title, body) => tests.push({ title, body }));
  suites.push({ name, tests });
}

async function runAll({ filter } = {}) {
  let passed = 0;
  let failed = 0;
  const failures = [];
  for (const s of suites) {
    if (filter && !s.name.toLowerCase().includes(filter)) continue;
    console.log(`\n${s.name}`);
    for (const t of s.tests) {
      const started = Date.now();
      try {
        await t.body();
        passed += 1;
        console.log(`  ✔ ${t.title} (${Date.now() - started} ms)`);
      } catch (err) {
        failed += 1;
        failures.push({ suite: s.name, title: t.title, err });
        console.log(`  ✖ ${t.title}`);
        console.log(`      ${String(err && err.stack ? err.stack : err).split('\n').slice(0, 6).join('\n      ')}`);
      }
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  return failed;
}

// Captures every ipcMain.handle registration so tests can invoke handlers
// directly with a fake event, exactly as the renderer's invoke() would.
const handlers = new Map();
ipcMain.handle = (channel, fn) => {
  handlers.set(channel, fn);
};

function invoke(channel, ...args) {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`No handler registered for ${channel}`);
  return Promise.resolve().then(() => fn({ sender: null }, ...args));
}

async function rejects(promiseOrFn, pattern) {
  try {
    await (typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn);
  } catch (err) {
    if (pattern && !pattern.test(String(err.message))) {
      throw new Error(`Rejected with "${err.message}", expected ${pattern}`);
    }
    return err;
  }
  throw new Error(`Expected rejection${pattern ? ` matching ${pattern}` : ''}`);
}

module.exports = { suite, runAll, invoke, handlers, rejects };
