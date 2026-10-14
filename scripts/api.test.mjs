import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['src/api.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'host', setup(build) {
    build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'host', namespace: 'stub' }));
    build.onResolve({ filter: /^\.\/ui$/ }, () => ({ path: 'ui', namespace: 'stub' }));
    build.onLoad({ filter: /.*/, namespace: 'stub' }, ({ path }) => ({ contents: path === 'host' ? `
      export class TFile { constructor(path) { this.path = path; this.basename = path.split('/').pop().replace(/\\.md$/, ''); this.stat = { ctime: 100 }; } }
      globalThis.__ApiTFile = TFile;
      export class Modal {} export class Notice {} export const parseYaml = JSON.parse;
      export const parseFrontMatterAliases = meta => meta.aliases ?? [];
    ` : `
      export class TypePicker {
        constructor(app, schemas, choose, dismiss) { Object.assign(this, { schemas, choose, dismiss }); app.dialog = this; }
        open() {} close() { this.dismiss?.(); }
      }
      export class CreateNodeModal {
        constructor(app, index, schema, created, title, folder, schemaFolder, body, dismiss, alive) {
          Object.assign(this, { schema, created, title, dismiss, alive }); app.dialog = this;
        }
        open() {} close() { this.dismiss?.(); }
      }
    ` }));
  } }] });
const { PublicFileClassInlineApi } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const schema = { path: 'Schemas/person.md', basename: 'person' };
  const file = { path: 'Nodes/Ada.md', basename: 'Ada' };
  const meta = { nodeSchema: 1, nodeType: 'person', label: 'Person', highlight: 'green' };
  const files = [schema, file];
  const app = { vault: { getMarkdownFiles: () => files, getAbstractFileByPath: path => files.find(file => file.path === path),
    cachedRead: async () => `---\n${JSON.stringify(meta)}\n---\n# {{title}}` },
    metadataCache: { getFileCache: target => target === schema ? { frontmatter: meta } : target === file ? { frontmatter: { type: 'person' } } : null } };
  const entry = { file, type: 'person', labels: ['Ada', 'Countess'] };
  let rebuilds = 0;
  const index = { setFolder() { rebuilds++; }, all: () => files.includes(file) ? [entry] : [], search() { return this.all().map(entry => ({ entry })); } };
  const settings = { schemasFolder: 'Schemas', nodesFolder: 'Nodes' };
  const tracked = [];
  const api = new PublicFileClassInlineApi(app, index, () => settings, { track: (...args) => tracked.push(args) });
  return { api, app, meta, files, file, settings, tracked, rebuilds: () => rebuilds };
}
test('versioned snapshots expose paths, aliases and live colors without leaking mutations', () => {
  const f = fixture();
  assert.equal(f.api.version, 1);
  assert.deepEqual(f.api.listTypes(), [{ type: 'person', label: 'Person', color: 'green' }]);
  assert.deepEqual(f.api.searchNodes('Ada')[0], { path: 'Nodes/Ada.md', title: 'Ada', type: 'person', aliases: ['Countess'], color: 'green' });
  f.api.getNode(f.file.path).aliases.push('bad');
  f.meta.highlight = 'purple';
  assert.deepEqual(f.api.getNode(f.file.path).aliases, ['Countess']);
  assert.equal(f.api.getNode(f.file.path).color, 'purple');
  f.files.pop();
  assert.equal(f.api.getNode(f.file.path), null);
  assert.ok(f.rebuilds() >= 4);
});
test('type picker cancellation and form cancellation resolve null', async () => {
  const { api, app } = fixture();
  const first = api.createNode({}); await tick(); app.dialog.close(); assert.equal(await first, null);
  const second = api.createNode({}); await tick();
  const picker = app.dialog; picker.choose(picker.schemas[0]); picker.close();
  assert.ok(app.dialog.alive()); app.dialog.close(); assert.equal(await second, null);
});
test('creation returns immediately before metadata indexing; no editor or pruning dependencies', async () => {
  const { api, app, files } = fixture();
  const pending = api.createNode({ type: 'person', suggestedTitle: 'Grace', sourcePath: 'Reading/book.md' }); await tick();
  assert.equal(app.dialog.title, 'Grace');
  const file = { path: 'Nodes/Grace.md', basename: 'Grace' }; files.push(file);
  app.dialog.created(file, '---\n{"type":"person","aliases":["Admiral"]}\n---\n# Grace');
  app.dialog.close();
  assert.equal((await pending).path, file.path);
  assert.deepEqual(api.getNode(file.path).aliases, ['Admiral']);
});
for (const race of ['untyped metadata', 'replacement']) test(`recent creation does not survive ${race}`, async () => {
  const { api, app, files } = fixture();
  const pending = api.createNode({ type: 'person' }); await tick();
  const file = { path: 'Nodes/Grace.md', basename: 'Grace' }; files.push(file);
  app.dialog.created(file, '---\n{"type":"person"}\n---\n');
  await pending;
  assert.ok(api.getNode(file.path));
  if (race === 'replacement') files[files.indexOf(file)] = { ...file };
  else {
    const cache = app.metadataCache.getFileCache;
    app.metadataCache.getFileCache = target => target === file ? {} : cache(target);
  }
  assert.equal(api.getNode(file.path), null);
  assert.ok(!api.searchNodes('').some(node => node.path === file.path));
});
test('disable resolves pending requests, closes dialogs, and makes retained API inert', async () => {
  const { api, app } = fixture();
  const pending = api.createNode({ type: 'person' }); await tick();
  api.dispose(); assert.equal(await pending, null); assert.equal(app.dialog.alive(), false);
  assert.deepEqual(api.listTypes(), []); assert.deepEqual(api.searchNodes(''), []);
  assert.equal(api.getNode('Nodes/Ada.md'), null); assert.equal(await api.createNode({}), null);
});
for (const folder of ['nodesFolder', 'schemasFolder']) test(`changing ${folder} invalidates the open creation form`, async () => {
  const { api, app, settings } = fixture();
  const pending = api.createNode({ type: 'person' }); await tick();
  settings[folder] = 'Changed';
  assert.equal(app.dialog.alive(), false);
  assert.equal(await pending, null);
});
test('search derives colors once per call, not once per result', () => {
  const { api } = fixture();
  let calls = 0;
  const original = api.listTypes.bind(api);
  api.listTypes = () => { calls++; return original(); };
  api.searchNodes('');
  assert.equal(calls, 1);
});
test('caller abort closes its form and invalidates pending creation', async () => {
  const { api, app } = fixture();
  const controller = new AbortController();
  let removed = 0;
  const remove = controller.signal.removeEventListener.bind(controller.signal);
  controller.signal.removeEventListener = (...args) => { removed++; remove(...args); };
  const pending = api.createNode({ type: 'person', signal: controller.signal }); await tick();
  let closed = 0;
  const close = app.dialog.close.bind(app.dialog);
  app.dialog.close = () => { closed++; close(); };
  controller.abort(); controller.abort();
  assert.equal(await pending, null); assert.equal(app.dialog.alive(), false);
  assert.equal(closed, 1); assert.equal(removed, 1);
});
test('already-aborted and aborted-during-load requests never open a dialog', async () => {
  for (const before of [true, false]) {
    const { api, app } = fixture();
    const controller = new AbortController();
    if (before) controller.abort();
    const pending = api.createNode({ signal: controller.signal });
    controller.abort();
    assert.equal(await pending, null); await tick(); assert.equal(app.dialog, undefined);
  }
});
for (const mode of ['success', 'authored', 'failure', 'unlinked', 'disabled', 'standalone', 'replaced', 'abort-link', 'abort-read', 'replace-source-read', 'replace-target-read', 'read-failure']) test(`opt-in cleanup provenance: ${mode}`, async () => {
  const f = fixture(), source = new globalThis.__ApiTFile('Reading/book.md'), node = new globalThis.__ApiTFile('Nodes/New.md');
  f.files.push(source, node);
  const controller = new AbortController();
  f.app.vault.read = async () => {
    if (mode === 'abort-read') controller.abort();
    if (mode === 'replace-source-read') f.files.splice(f.files.indexOf(source), 1, new globalThis.__ApiTFile(source.path));
    if (mode === 'replace-target-read') f.files.splice(f.files.indexOf(node), 1, new globalThis.__ApiTFile(node.path));
    if (mode === 'read-failure') throw new Error('read failed');
    return mode === 'unlinked' ? 'words' : '==[[Nodes/New.md|words]]==';
  };
  let links = 0;
  const link = async result => {
    links++; assert.equal(result.path, node.path);
    if (mode === 'failure') throw new Error('stale');
    if (mode === 'disabled') f.api.dispose();
    if (mode === 'abort-link') controller.abort();
    if (mode === 'replaced') f.files.splice(f.files.indexOf(node), 1, new globalThis.__ApiTFile(node.path));
  };
  const options = { type: 'person', sourcePath: source.path, signal: controller.signal };
  const pending = mode === 'standalone' ? f.api.createNode(options) : f.api.createNodeForLink(options, link);
  await tick();
  const content = '---\n{"type":"person"}\n---\n# New';
  f.app.dialog.created(node, content, mode !== 'authored');
  if (mode === 'failure') await assert.rejects(pending, /stale/); else await pending;
  assert.equal(links, mode === 'standalone' ? 0 : 1);
  assert.equal(f.tracked.length, mode === 'success' ? 1 : 0);
  if (mode === 'success') assert.deepEqual(f.tracked[0].slice(0, 4), [node, source.path, node.path, content]);
});
test('disable during schema read never opens dialog; unknown types resolve null', async () => {
  const f = fixture(); const pending = f.api.createNode({}); f.api.dispose();
  assert.equal(await pending, null); await tick(); assert.equal(f.app.dialog, undefined);
  assert.equal(await fixture().api.createNode({ type: 'missing' }), null);
});
