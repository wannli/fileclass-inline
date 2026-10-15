import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['src/creation.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'host', setup(build) {
    build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'host', namespace: 'stub' }));
    build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: `
      export class TFile { constructor(path) { this.path=path;this.basename=path.split('/').at(-1).replace(/\\.md$/, ''); } }
      export class TFolder { constructor(path) { this.path=path; } }
      globalThis.__CreationFile=TFile; globalThis.__CreationFolder=TFolder;
      export const stringifyYaml=JSON.stringify; export class AbstractInputSuggest {} export class PluginSettingTab {} export class Setting {}
    ` }));
  } }] });
const { createTypedNote, renderTypedNote, waitForBinding, titleError } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
const settings = { nodesFolder: 'Nodes', classProperty: 'fileClass', trigger: '@' };
function fixture() {
  const files = new Map(), contents = new Map();
  const token = {}, backend = { token: () => token, types: async () => [{ name: 'Person', icon: 'user' }], classesFor: async () => ['Person'] };
  let writes = 0;
  const app = { vault: {
    getAbstractFileByPath: path => files.get(path) ?? null,
    createFolder: async path => { files.set(path, new globalThis.__CreationFolder(path)); },
    create: async (path, text) => {
      assert.ok(!files.has(path), 'never overwrite'); writes++;
      const file = new globalThis.__CreationFile(path); files.set(path, file); contents.set(path, text); return file;
    },
  } };
  return { app, backend, token, files, contents, writes: () => writes };
}
test('convention creation writes only the class marker, title and literal selected body', async () => {
  const f = fixture();
  const body = 'Original paragraph\nsecond line {{not a template}}';
  const file = await createTypedNote(f.app, f.backend, settings, 'Person', 'Ada', body);
  const bytes = f.contents.get(file.path);
  assert.equal(file.path, 'Nodes/Ada.md');
  assert.deepEqual(JSON.parse(bytes.split('\n')[1]), { fileClass: 'Person' });
  assert.ok(bytes.endsWith(`${body}\n`));
  assert.equal(f.writes(), 1);
  assert.doesNotMatch(bytes, /schema:|optional:/);
});
test('custom binding uses safe YAML serialization, not interpolated frontmatter', async () => {
  assert.equal(renderTypedNote('A: [quoted]', 'Ada', 'type'), '---\n{"type":"A: [quoted]"}\n---\n# Ada\n');
  const f = fixture();
  const file = await createTypedNote(f.app, f.backend, { ...settings, classProperty: 'type' }, 'Person', 'Ada');
  assert.deepEqual(JSON.parse(f.contents.get(file.path).split('\n')[1]), { type: 'Person' });
});
test('creation uses the live Fileclass alias instead of its own fallback', async () => {
  const f = fixture();
  let alias = 'oldAlias';
  f.backend.bindingProperty = () => alias;
  f.app.vault.createFolder = async path => {
    f.files.set(path, new globalThis.__CreationFolder(path)); alias = 'note type';
  };
  const file = await createTypedNote(f.app, f.backend, settings, 'Person', 'Ada');
  assert.deepEqual(JSON.parse(f.contents.get(file.path).split('\n')[1]), { 'note type': 'Person' });
});
test('invalid Fileclass alias prevents writing a note', async () => {
  const f = fixture();
  f.backend.bindingProperty = () => { throw new Error('Invalid alias'); };
  await assert.rejects(createTypedNote(f.app, f.backend, settings, 'Person', 'Ada'), /Invalid alias/);
  assert.equal(f.writes(), 0);
});
for (const title of ['../Ada', ' Ada', 'Ada ', 'Ada.', 'Ada/new', 'A\nB']) test(`reject unsafe name ${JSON.stringify(title)}`, async () => {
  const f = fixture();
  assert.ok(titleError(title));
  await assert.rejects(createTypedNote(f.app, f.backend, settings, 'Person', title));
  assert.equal(f.writes(), 0);
});
for (const mode of ['abort-before', 'abort-folder', 'reload-folder', 'schema-removed', 'folder-is-file', 'collision']) test(`safe creation boundary: ${mode}`, async () => {
  const f = fixture(), controller = new AbortController();
  if (mode === 'abort-before') controller.abort();
  if (mode === 'abort-folder') f.app.vault.createFolder = async () => { controller.abort(); };
  if (mode === 'reload-folder') f.app.vault.createFolder = async () => { f.backend.token = () => ({}); };
  if (mode === 'schema-removed') { let reads = 0; f.backend.types = async () => ++reads === 1 ? [{ name: 'Person' }] : []; }
  if (mode === 'folder-is-file') f.files.set('Nodes', new globalThis.__CreationFile('Nodes'));
  if (mode === 'collision') f.files.set('Nodes/Ada.md', new globalThis.__CreationFile('Nodes/Ada.md'));
  await assert.rejects(createTypedNote(f.app, f.backend, settings, 'Person', 'Ada', undefined, controller.signal));
  assert.equal(f.writes(), 0);
});
test('binding confirmation resolves through Fileclass, not an assumed frontmatter marker', async () => {
  const f = fixture(), file = await createTypedNote(f.app, f.backend, settings, 'Person', 'Ada');
  f.backend.classesFor = async () => ['Global', 'Person'];
  assert.deepEqual(await waitForBinding(f.app, f.backend, file, 'Person', f.token), ['Global', 'Person']);
  f.backend.classesFor = async () => [];
  await assert.rejects(waitForBinding(f.app, f.backend, file, 'Person', f.token, undefined, 0), /not recognized/);
  assert.equal(f.files.get(file.path), file);
});
for (const mode of ['replacement', 'rename', 'reload', 'abort']) test(`binding guard after async resolution: ${mode}`, async () => {
  const f = fixture(), controller = new AbortController();
  const file = await createTypedNote(f.app, f.backend, settings, 'Person', 'Ada');
  f.backend.classesFor = async () => {
    if (mode === 'replacement') f.files.set(file.path, new globalThis.__CreationFile(file.path));
    if (mode === 'rename') file.path = 'Nodes/Renamed.md';
    if (mode === 'reload') f.backend.token = () => ({});
    if (mode === 'abort') controller.abort();
    return ['Person'];
  };
  await assert.rejects(waitForBinding(f.app, f.backend, file, 'Person', f.token, controller.signal));
});
