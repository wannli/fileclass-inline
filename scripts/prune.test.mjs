import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const result = await build({ entryPoints: ['src/prune.ts', 'src/create.ts'], bundle: true, platform: 'node', format: 'esm', outdir: 'out', write: false,
  plugins: [{ name: 'host', setup(build) {
    build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'host' }));
    build.onLoad({ filter: /.*/, namespace: 'host' }, () => ({ contents: 'export class TFile { constructor(path){this.path=path;this.extension="md";this.stat={ctime:100,mtime:100}} };  globalThis.__NodeTestTFile = TFile; export class MarkdownView {}; export class TFolder {}; export const parseYaml = JSON.parse; export const stringifyYaml = JSON.stringify;' }));
  } }],
});
const load = name => import(`data:text/javascript;base64,${Buffer.from(result.outputFiles.find(file => file.path.endsWith(name)).contents).toString('base64')}`);
const { PruneManager } = await load('prune.js');
const TFile = globalThis.__NodeTestTFile;
const { inferableOnly } = await load('create.js');

function setup() {
  const schemaFile = new TFile('Schemas/person.md');
  const schema = { nodeSchema: 1, nodeType: 'person', label: 'person', properties: {}, template: '# {{title}}', path: schemaFile.path };
  const node = new TFile('Nodes/Test.md'), source = new TFile('Source.md');
  const contents = new Map([[node.path, '# Test'], [source.path, '[[Test]]']]);
  const files = new Map([[node.path, node], [source.path, source], [schemaFile.path, schemaFile]]);
  const trashed = [];
  const app = { metadataCache: { resolvedLinks: { [source.path]: { [node.path]: 1 } }, unresolvedLinks: {}, getFileCache: () => ({}) },
    workspace: { iterateAllLeaves: () => {} }, vault: {
      getMarkdownFiles: () => [schemaFile], cachedRead: async () => `---\n${JSON.stringify({ nodeSchema: 1, nodeType: 'person', properties: {} })}\n---\n# {{title}}`,
      getAbstractFileByPath: path => files.get(path) ?? null, read: async file => contents.get(file.path),
      trash: async file => { trashed.push(file.path); files.delete(file.path); },
    } };
  const manager = new PruneManager(app, () => ({ nodesFolder: 'Nodes', schemasFolder: 'Schemas', cleanupOrphans: true }), async () => {});
  manager.restore({ [node.path]: { path: node.path, createdAt: node.stat.ctime, sourcePath: source.path, sourceLink: '[[Test]]', content: '# Test', schemaPath: schemaFile.path, schemaSnapshot: JSON.stringify(schema) } });
  return { manager, app, contents, node, source, trashed, files };
}

test('only an observed, pristine, unlinked node is trashed', async () => {
  const state = setup();
  try {
    await state.manager.sweep(); // Never delete a node merely because it was unlinked at startup.
    assert.deepEqual(state.trashed, []);
    state.manager.onResolved();
    state.app.metadataCache.resolvedLinks = {};
    state.contents.set(state.source.path, '');
    await state.manager.sweep();
    assert.deepEqual(state.trashed, [state.node.path]);
  } finally { state.manager.dispose(); }
});

test('edited content, outgoing links and user-entered fields keep nodes', async () => {
  const state = setup();
  try {
    state.manager.onResolved();
    state.app.metadataCache.resolvedLinks = {};
    state.contents.set(state.source.path, '');
    state.contents.set(state.node.path, '# Test\nPersonal note');
    await state.manager.sweep();
    assert.deepEqual(state.trashed, []);
    state.contents.set(state.node.path, '# Test');
    state.app.metadataCache.resolvedLinks[state.node.path] = { 'Other.md': 1 };
    await state.manager.sweep();
    assert.deepEqual(state.trashed, []);
    delete state.app.metadataCache.resolvedLinks[state.node.path];
    state.node.stat.ctime = 101; // A different file now occupies the old path.
    await state.manager.sweep();
    assert.deepEqual(state.trashed, []);
    state.manager.forgetBySource(state.source.path); // Removing the entire source note is not a link deletion.
    assert.deepEqual(state.manager.entries(), {});
    assert.equal(inferableOnly({ properties: { active: { default: true } } }, { active: true }), true);
    assert.equal(inferableOnly({ properties: { active: { default: true } } }, { active: false }), false);
    assert.equal(inferableOnly({ properties: {} }, {}, 'Copied selection'), false);
  } finally { state.manager.dispose(); }
});
