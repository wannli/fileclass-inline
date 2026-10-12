import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['src/api.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'host', setup(build) {
    build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'host', namespace: 'stub' }));
    build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: `
      export class Modal {
        constructor(app) { this.app = app; this.scope = { register() {} }; }
        open() { this.app.dialog = this; }
        close() { this.onClose?.(); }
      }
      export class SuggestModal extends Modal { setPlaceholder() {} }
      export class Setting {} export class Notice {} export class TFile {} export class TFolder {}
      export const parseYaml = JSON.parse;
      export const stringifyYaml = JSON.stringify;
      export const parseFrontMatterAliases = meta => meta.aliases ?? [];
    ` }));
  } }] });
const { PublicNodesApi } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function fixture() {
  const schemaFile = { path: 'Schemas/person.md' };
  const folder = deferred();
  let body = '# {{title}}';
  let writes = 0;
  let target = { path: 'Nodes/Target.md' };
  const app = { vault: {
    getMarkdownFiles: () => [schemaFile], getAbstractFileByPath: () => null,
    cachedRead: async () => `---\n${JSON.stringify({ nodeSchema: 1, nodeType: 'person', properties: { ref: { kind: 'link', default: '[[Target]]' } } })}\n---\n${body}`,
    createFolder: () => folder.promise,
    create: async path => { writes++; return { path, basename: 'Ada' }; },
  }, metadataCache: { getFirstLinkpathDest: () => target, getFileCache: () => null } };
  const index = { setFolder() {}, rebuild() {}, all: () => target ? [{ file: target, type: 'person' }] : [] };
  const api = new PublicNodesApi(app, index, () => ({ nodesFolder: 'Nodes', schemasFolder: 'Schemas' }));
  const prepare = () => {
    app.dialog.errorEl = { setText(text) { app.error = text; } };
    app.dialog.createButton = { setDisabled() {} };
  };
  return { api, app, folder, prepare, writes: () => writes, changeSchema() { body = 'Changed'; }, removeTarget() { target = null; } };
}
for (const mode of ['abort', 'schema', 'link']) test(`real creation rechecks ${mode} after waiting for folder creation`, async () => {
  const f = fixture(); const controller = new AbortController();
  const pending = f.api.createNode({ type: 'person', suggestedTitle: 'Ada', signal: controller.signal }); await tick();
  f.prepare();
  const submitting = f.app.dialog.submit(); await tick();
  if (mode === 'abort') controller.abort();
  if (mode === 'schema') f.changeSchema();
  if (mode === 'link') f.removeTarget();
  f.folder.resolve(); await submitting;
  assert.equal(f.writes(), 0);
  if (mode !== 'abort') {
    assert.match(f.app.error, mode === 'schema' ? /Schema changed/ : /choose an existing/);
    f.app.dialog.close();
  }
  assert.equal(await pending, null);
});
test('real type picker close-before-selection preserves the selected creation form', async () => {
  const f = fixture();
  const pending = f.api.createNode({ suggestedTitle: 'Ada' }); await tick();
  const picker = f.app.dialog;
  const schema = picker.getSuggestions('')[0];
  picker.close(); picker.onChooseSuggestion(schema); await tick();
  assert.notEqual(f.app.dialog, picker);
  assert.equal(f.app.dialog.isActive(), true);
  f.app.dialog.close(); assert.equal(await pending, null);
});
test('abort after file write starts retains standalone file but resolves null', async () => {
  const f = fixture(); const controller = new AbortController(); const write = deferred();
  let started = false;
  f.app.vault.create = async path => { started = true; await write.promise; return { path, basename: 'Ada' }; };
  const pending = f.api.createNode({ type: 'person', suggestedTitle: 'Ada', signal: controller.signal }); await tick();
  f.prepare(); const submitting = f.app.dialog.submit();
  f.folder.resolve(); await tick(); assert.equal(started, true);
  controller.abort(); assert.equal(await pending, null);
  write.resolve(); await submitting;
});
test('cleanup eligibility uses rendered values, not edits made during the file write', async () => {
  const f = fixture(), write = deferred();
  let bytes, inferable;
  f.app.vault.create = async (path, content) => { bytes = content; await write.promise; return { path, basename: 'Ada' }; };
  const pending = f.api.createNode({ type: 'person', suggestedTitle: 'Ada' }); await tick();
  const dialog = f.app.dialog, created = dialog.created;
  dialog.created = (file, content, eligible) => { inferable = eligible; created(file, content, eligible); };
  dialog.values.ref = '[[Authored]]';
  f.prepare(); const submitting = dialog.submit(); f.folder.resolve(); await tick();
  assert.match(bytes, /Authored/);
  dialog.values.ref = '[[Target]]';
  write.resolve(); await submitting; await pending;
  assert.equal(inferable, false);
});
