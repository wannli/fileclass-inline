import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { build } from 'esbuild';

const { outputFiles } = await build({
  stdin: { contents: `export { FileclassCache } from './src/fileclass-cache';
    export { FileclassBridge } from './src/fileclass'; export { NodeIndex } from './src/index';
    export { Events, TFile, TFolder } from 'obsidian';`, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'cache-host', setup(build) {
    build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'host', namespace: 'stub' }));
    build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: `
      export class Events {
        refs = new Set();
        on(name, callback) { const ref = { name, callback }; this.refs.add(ref); return ref; }
        offref(ref) { this.refs.delete(ref); }
        trigger(name, ...args) { for (const ref of [...this.refs]) if (ref.name === name) ref.callback(...args); }
      }
      export class TFile {
        constructor(path) { this.path = path; }
        get basename() { return this.path.split('/').at(-1).replace(/\\.md$/, ''); }
        get extension() { return this.path.split('.').at(-1); }
      }
      export class TFolder { constructor(path) { this.path = path; } }
      export const parseFrontMatterAliases = meta => meta?.aliases ?? [];
      export const prepareFuzzySearch = query => text => text.includes(query) ? { score: 0 } : null;
    ` }));
  } }],
});
const { FileclassCache, FileclassBridge, NodeIndex, Events, TFile, TFolder } =
  await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`);

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function tick(t, milliseconds = 0) { t.mock.timers.tick(milliseconds); await nextTurn(); }
function fixture(t, size = 3) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 0 });
  const files = new Map(), memberships = new Map(), metadata = new Map(), hooks = {};
  const counts = { full: 0, active: 0, overlap: 0, scans: 0, catalog: 0, schema: 0, explain: [], disconnected: 0 };
  const state = { classes: [{ name: 'Person', icon: 'user' }],
    schema: { name: 'Person', ancestors: [], options: { priority: 1 }, fields: [] }, api: undefined };
  function api() {
    const forbidden = async () => { throw new Error('Unexpected public API read'); };
    return {
      version: '1.2.0',
      async listFileClasses() { counts.catalog++; await hooks.catalog?.(); return structuredClone(state.classes); },
      async getSchema(name) { counts.schema++; await hooks.schema?.(name); return structuredClone(state.schema); },
      async explain(path) {
        counts.explain.push(path);
        const fileClasses = [...(memberships.get(path) ?? [])];
        await hooks.explain?.(path);
        return { fileClasses };
      },
      getFields: forbidden, getValue: forbidden, allowedValues: forbidden, fileCandidates: forbidden, setValue: forbidden,
    };
  }
  state.api = api();
  const app = { vault: new Events(), metadataCache: new Events(), workspace: new Events(),
    plugins: { getPlugin: () => state.api ? { api: state.api } : null } };
  Object.assign(app.vault, {
    getAbstractFileByPath: path => files.get(path) ?? null,
    getMarkdownFiles() { counts.scans++; return [...files.values()].filter(file => file instanceof TFile && file.extension === 'md'); },
  });
  app.metadataCache.getFileCache = file => metadata.get(file);
  function add(path, classes = ['Person']) {
    const file = new TFile(path); files.set(path, file); memberships.set(path, classes); return file;
  }
  for (let i = 0; i < size; i++) add(`note-${i}.md`);
  const backend = new FileclassBridge(app), members = backend.members.bind(backend);
  backend.members = async signal => {
    counts.full++; counts.active++; counts.overlap = Math.max(counts.overlap, counts.active);
    try { return await members(signal); } finally { counts.active--; }
  };
  const index = new NodeIndex(app, () => backend.members());
  const cache = new FileclassCache(app, backend, index, () => counts.disconnected++);
  t.after(() => { cache.dispose(); t.mock.timers.reset(); });
  const changed = file => app.metadataCache.trigger('changed', file);
  const indexed = () => app.workspace.trigger('fileclass:indexed');
  const start = async () => { cache.start(); await cache.refresh(); };
  return { app, backend, index, cache, files, memberships, metadata, hooks, counts, state, api, add, changed, indexed, start };
}

test('startup is one full source snapshot; healthy ticks and synchronous lookups perform no public reads', async t => {
  const f = fixture(t); await f.start();
  assert.equal(f.counts.full, 1); assert.equal(f.counts.scans, 1);
  assert.equal(f.counts.explain.length, 3); assert.equal(f.index.all().length, 3);
  assert.deepEqual(f.cache.types(), [{ name: 'Person', icon: 'user' }]);
  assert.equal(f.cache.typeInfo('Person').icon, 'user'); assert.equal(f.cache.typeInfo('Missing'), undefined);
  const counts = structuredClone(f.counts);
  await tick(t, 600_000);
  for (let i = 0; i < 100; i++) { f.cache.available(); f.cache.typeInfo('Person'); f.cache.types(); }
  assert.deepEqual(f.counts, counts);
  f.cache.start(); assert.equal(f.app.vault.refs.size, 3);
});

test('burst note edits debounce to one path explain, refresh aliases, and never fetch the catalog', async t => {
  const f = fixture(t); await f.start();
  const file = f.files.get('note-0.md');
  f.metadata.set(file, { frontmatter: { aliases: ['Changed alias'] } });
  f.memberships.set(file.path, ['Global', 'Person']);
  for (let i = 0; i < 30; i++) f.changed(file);
  await tick(t, 149); assert.equal(f.counts.explain.length, 3);
  await tick(t, 1);
  assert.deepEqual(f.counts.explain.slice(3), [file.path]);
  assert.equal(f.counts.full, 1); assert.equal(f.counts.catalog, 1); assert.equal(f.counts.schema, 1);
  assert.equal(f.index.search('Changed alias')[0].entry.file, file);
  f.memberships.set(file.path, []); f.changed(file); await tick(t, 150);
  assert.equal(f.index.all().length, 2);
});

test('create queues only the new markdown identity; resolved and non-markdown edits do not scan', async t => {
  const f = fixture(t); await f.start();
  const file = f.add('created.md'); f.app.vault.trigger('create', file);
  f.app.metadataCache.trigger('resolved'); f.changed(f.add('image.png'));
  await tick(t, 150);
  assert.equal(f.counts.full, 1); assert.deepEqual(f.counts.explain.slice(3), ['created.md']);
  assert.equal(f.index.all().length, 4);
});

test('coalesced indexed after a known edit checks schema and requeues recent paths, never full scans', async t => {
  const f = fixture(t); await f.start();
  const file = f.files.get('note-0.md'); f.changed(file); await tick(t, 150);
  f.memberships.set(file.path, ['Resolved']);
  for (let i = 0; i < 20; i++) f.indexed();
  await tick(t, 150);
  assert.equal(f.counts.catalog, 2); assert.equal(f.counts.schema, 2); assert.equal(f.counts.full, 1);
  assert.deepEqual(f.counts.explain.slice(3), [file.path, file.path]);
  assert.deepEqual(f.index.all().find(entry => entry.file === file).classes, ['Resolved']);
  f.indexed(); await tick(t, 150);
  assert.equal(f.counts.explain.length, 5, 'consumed recent paths are not explained on every indexed event');
});

for (const mutation of ['icon', 'options', 'fields', 'ancestors', 'catalog']) test(`known-note indexed detects changed ${mutation} and reconciles fully`, async t => {
  const f = fixture(t); await f.start();
  f.changed(f.files.get('note-0.md')); await tick(t, 150);
  if (mutation === 'icon') f.state.classes[0].icon = 'star';
  if (mutation === 'options') f.state.schema.options.aliases = ['custom'];
  if (mutation === 'fields') f.state.schema.fields.push({ name: 'a', id: 'a', type: 'Input', options: { required: true }, path: '' });
  if (mutation === 'ancestors') f.state.schema.ancestors.push('Base');
  if (mutation === 'catalog') f.state.classes.push({ name: 'Other', icon: 'book' });
  f.indexed(); await tick(t, 150);
  assert.equal(f.counts.full, 2); assert.equal(f.counts.scans, 2);
  assert.equal(f.counts.catalog, 2, 'signature result is reused by the full reconciliation');
  assert.deepEqual(f.cache.types(), f.state.classes);
});

test('unexplained indexed forces reconciliation even when schema is unchanged', async t => {
  const f = fixture(t); await f.start();
  f.memberships.set('note-1.md', ['Global']); f.indexed(); await tick(t, 150);
  assert.equal(f.counts.full, 2);
  assert.deepEqual(f.index.all().find(entry => entry.file.path === 'note-1.md').classes, ['Global']);
});

test('full refresh callers coalesce and source loops never overlap', async t => {
  const f = fixture(t); await f.start();
  const gate = deferred(); f.hooks.explain = () => gate.promise;
  const first = f.cache.refresh(); await nextTurn();
  const pending = Array.from({ length: 15 }, () => f.cache.refresh());
  assert.equal(f.counts.full, 2); assert.equal(f.counts.active, 1);
  gate.resolve(); await Promise.all([first, ...pending]);
  assert.equal(f.counts.full, 2); assert.equal(f.counts.overlap, 1);
});

test('non-markdown deletion does not invalidate an in-flight full snapshot', async t => {
  const f = fixture(t); await f.start();
  const gate = deferred(); f.hooks.explain = () => gate.promise;
  const full = f.cache.refresh(); await nextTurn();
  const image = f.add('image.png'); f.files.delete(image.path); f.app.vault.trigger('delete', image);
  gate.resolve(); await full;
  assert.equal(f.counts.full, 2); assert.equal(f.index.all().length, 3);
});

test('dirty notes during a full snapshot are buffered, then replayed after the swap', async t => {
  const f = fixture(t); await f.start();
  const gate = deferred(), file = f.files.get('note-0.md');
  f.hooks.explain = path => path === file.path ? gate.promise : undefined;
  const full = f.cache.refresh(); await nextTurn();
  f.memberships.set(file.path, ['Updated']); f.changed(file); await tick(t, 150);
  assert.equal(f.counts.explain.length, 4, 'incremental reads stay buffered until the full snapshot swaps');
  gate.resolve(); await full;
  assert.equal(f.counts.full, 2); assert.equal(f.counts.explain.length, 7);
  assert.equal(f.index.all().length, 3);
  assert.deepEqual(f.index.all().find(entry => entry.file === file).classes, ['Updated']);
});

for (const mode of ['delete', 'rename', 'replacement']) test(`pending note result is guarded against ${mode}`, async t => {
  const f = fixture(t); await f.start();
  const file = f.files.get('note-0.md'), oldPath = file.path, gate = deferred();
  f.hooks.explain = path => path === oldPath ? gate.promise : undefined;
  f.changed(file); await tick(t, 150);
  f.files.delete(oldPath);
  let replacement;
  if (mode === 'rename') {
    file.path = 'renamed.md'; f.files.set(file.path, file); f.memberships.set(file.path, ['Renamed']);
    f.app.vault.trigger('rename', file, oldPath);
  } else if (mode === 'replacement') {
    replacement = f.add(oldPath, ['Replacement']); f.app.vault.trigger('create', replacement);
    f.app.vault.trigger('delete', file); // Late delete of the old identity cannot erase the new queue.
  } else f.app.vault.trigger('delete', file);
  assert.ok(!f.index.all().some(entry => entry.file === file && entry.file.path === oldPath));
  gate.resolve(); await nextTurn(); await tick(t, 150);
  const entries = f.index.all();
  if (mode === 'delete') assert.equal(entries.length, 2);
  else assert.deepEqual(entries.find(entry => entry.file === (replacement ?? file)).classes, [mode === 'rename' ? 'Renamed' : 'Replacement']);
  assert.equal(f.counts.full, 1);
});

test('a newer per-path edit supersedes an in-flight explanation', async t => {
  const f = fixture(t); await f.start();
  const file = f.files.get('note-0.md'), gate = deferred();
  f.hooks.explain = () => gate.promise;
  f.changed(file); await tick(t, 150);
  f.memberships.set(file.path, ['Latest']); f.changed(file);
  gate.resolve(); await nextTurn(); await tick(t, 150);
  assert.deepEqual(f.index.all().find(entry => entry.file === file).classes, ['Latest']);
  assert.equal(f.counts.full, 1);
});

test('delete during bootstrap overlays one full scan, retains other rows, and replays dirty notes', async t => {
  const f = fixture(t), gate = deferred(), edited = f.files.get('note-0.md'), deleted = f.files.get('note-2.md');
  f.hooks.explain = () => gate.promise;
  f.cache.start(); const full = f.cache.refresh(); await nextTurn();
  f.memberships.set(edited.path, ['Updated']); f.changed(edited); await tick(t, 150);
  f.files.delete(deleted.path); f.app.vault.trigger('delete', deleted);
  assert.ok(!f.index.all().some(entry => entry.file === deleted));
  gate.resolve(); await full;
  assert.deepEqual(f.index.all().map(entry => [entry.file.path, entry.classes]), [
    ['note-0.md', ['Updated']], ['note-1.md', ['Person']],
  ]);
  assert.equal(f.counts.full, 1); assert.equal(f.counts.scans, 1); assert.equal(f.counts.overlap, 1);
  assert.deepEqual(f.counts.explain, ['note-0.md', 'note-1.md', 'note-0.md']);
});

test('capture during bootstrap overlays one full scan, retains other rows, and replays dirty notes', async t => {
  const f = fixture(t), gate = deferred(), edited = f.files.get('note-0.md');
  f.hooks.explain = () => gate.promise;
  f.cache.start(); const full = f.cache.refresh(); await nextTurn();
  const file = f.add('captured.md'); f.index.remember(file, ['Person']);
  f.memberships.set(edited.path, ['Updated']); f.changed(edited); await tick(t, 150);
  gate.resolve(); await full;
  assert.deepEqual(f.index.all().map(entry => [entry.file.path, entry.classes]), [
    ['note-0.md', ['Updated']], ['note-1.md', ['Person']], ['note-2.md', ['Person']], ['captured.md', ['Person']],
  ]);
  assert.equal(f.counts.full, 1); assert.equal(f.counts.scans, 1); assert.equal(f.counts.overlap, 1);
  assert.deepEqual(f.counts.explain, ['note-0.md', 'note-1.md', 'note-2.md', 'note-0.md']);
});

test('folder changes clear immediately and reconcile rather than scanning descendant paths', async t => {
  const f = fixture(t); await f.start();
  f.app.vault.trigger('rename', new TFolder('new'), 'old');
  assert.equal(f.index.all().length, 0); await nextTurn();
  assert.equal(f.counts.full, 2); assert.equal(f.index.all().length, 3);
});

test('ambiguous events reconcile at most every 120s and require five seconds of idle', async t => {
  const f = fixture(t); await f.start();
  const file = f.files.get('note-0.md'); f.changed(file); f.indexed(); await tick(t, 150);
  await tick(t, 118_850); assert.equal(f.counts.full, 1);
  f.changed(file); await tick(t, 150);
  await tick(t, 850); assert.equal(f.counts.full, 1, 'not idle at the 120-second rate limit');
  await tick(t, 3_999); assert.equal(f.counts.full, 1);
  await tick(t, 1); assert.equal(f.counts.full, 2);
  f.changed(file); f.indexed(); await tick(t, 150);
  await tick(t, 119_849); assert.equal(f.counts.full, 2);
  await tick(t, 1); assert.equal(f.counts.full, 3);
});

test('ambiguous indexed arriving during a full snapshot retains its eventual reconciliation', async t => {
  const f = fixture(t); await f.start();
  const gate = deferred(); f.hooks.explain = () => gate.promise;
  const full = f.cache.refresh(); await nextTurn();
  f.changed(f.files.get('note-0.md')); f.indexed(); await tick(t, 150);
  gate.resolve(); await full;
  assert.equal(f.counts.full, 2);
  await tick(t, 119_999); assert.equal(f.counts.full, 2);
  await tick(t, 1); assert.equal(f.counts.full, 3);
});

test('mass note changes yield via timers every forty reads, without vault or catalog enumeration', async t => {
  const f = fixture(t, 0); await f.start();
  for (let i = 0; i < 81; i++) f.changed(f.add(`batch-${i}.md`));
  await tick(t, 150); assert.equal(f.counts.explain.length, 40);
  await tick(t); assert.equal(f.counts.explain.length, 80);
  await tick(t); assert.equal(f.counts.explain.length, 81);
  assert.equal(f.index.all().length, 81); assert.equal(f.counts.scans, 1); assert.equal(f.counts.catalog, 1);
});

test('disable and re-enable each transition once; healthy intervals do not retry failed identities', async t => {
  const f = fixture(t); await f.start();
  f.state.api = undefined; await tick(t, 1_000);
  assert.equal(f.cache.available(), false); assert.equal(f.index.all().length, 0); assert.deepEqual(f.cache.types(), []);
  assert.equal(f.counts.disconnected, 1);
  await tick(t, 5_000); assert.equal(f.counts.disconnected, 1); assert.equal(f.counts.full, 1);
  f.state.api = f.api(); await tick(t, 1_000);
  assert.equal(f.cache.available(), true); assert.equal(f.counts.full, 2);
  await tick(t, 5_000); assert.equal(f.counts.full, 2);
});

for (const stage of ['catalog', 'schema', 'source']) test(`dispose during ${stage} settles refresh and stops subsequent public reads`, async t => {
  const f = fixture(t), gate = deferred();
  f.hooks[stage === 'source' ? 'explain' : stage] = () => gate.promise;
  f.cache.start(); const refresh = f.cache.refresh(); await nextTurn();
  f.cache.dispose(); await refresh;
  const counts = structuredClone(f.counts);
  gate.resolve(); await nextTurn(); await tick(t, 500_000);
  assert.equal(f.counts.catalog, counts.catalog); assert.equal(f.counts.schema, counts.schema);
  assert.deepEqual(f.counts.explain, counts.explain); assert.equal(f.cache.available(), false);
  assert.equal(f.index.all().length, 0); assert.deepEqual(f.cache.types(), []);
  for (const events of [f.app.vault, f.app.metadataCache, f.app.workspace]) assert.equal(events.refs.size, 0);
});

test('dispose at a full-source batch yield prevents the next batch and settles callers', async t => {
  const f = fixture(t, 81);
  f.cache.start(); const refresh = f.cache.refresh(); await nextTurn();
  assert.equal(f.counts.explain.length, 40);
  f.cache.dispose(); await refresh; await tick(t);
  assert.equal(f.counts.explain.length, 40); assert.equal(f.index.all().length, 0);
});

test('disconnect in a catalog await prevents all subsequent public reads', async t => {
  const f = fixture(t), gate = deferred(); f.hooks.catalog = () => gate.promise;
  f.cache.start(); const refresh = f.cache.refresh(); await nextTurn();
  f.state.api = undefined; await tick(t, 1_000); await refresh;
  gate.resolve(); await nextTurn();
  assert.equal(f.counts.catalog, 1); assert.equal(f.counts.schema, 0); assert.equal(f.counts.full, 0);
  assert.equal(f.cache.available(), false); assert.deepEqual(f.cache.types(), []);
});

test('API replacement during a source read never publishes the old snapshot or overlaps source loops', async t => {
  const f = fixture(t); await f.start();
  const gate = deferred(); f.hooks.explain = () => gate.promise;
  const refresh = f.cache.refresh(); await nextTurn();
  f.state.api = f.api(); f.state.classes[0].icon = 'new'; await tick(t, 1_000);
  assert.deepEqual(f.cache.types(), []); assert.equal(f.index.all().length, 0);
  gate.resolve(); await refresh; await nextTurn();
  assert.equal(f.counts.overlap, 1); assert.equal(f.cache.typeInfo('Person').icon, 'new');
  assert.equal(f.index.all().length, 3);
});

for (const stage of ['catalog', 'schema', 'source', 'incremental']) test(`${stage} failure fails closed and only explicit refresh retries the same API`, async t => {
  const f = fixture(t); await f.start();
  const key = stage === 'source' || stage === 'incremental' ? 'explain' : stage;
  f.hooks[key] = () => { throw new Error('Broken public source'); };
  if (stage === 'incremental') { f.changed(f.files.get('note-0.md')); await tick(t, 150); }
  else await f.cache.refresh();
  assert.equal(f.cache.available(), false); assert.equal(f.index.all().length, 0); assert.deepEqual(f.cache.types(), []);
  const full = f.counts.full; await tick(t, 5_000); assert.equal(f.counts.full, full);
  delete f.hooks[key]; await f.cache.refresh();
  assert.equal(f.cache.available(), true); assert.equal(f.index.all().length, 3);
});
