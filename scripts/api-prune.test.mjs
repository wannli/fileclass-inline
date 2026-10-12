import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({ stdin: { contents: "export { PublicNodesApi } from './src/api'; export { PruneManager } from './src/prune';", resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'host', setup(build) {
    build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'host', namespace: 'stub' }));
    build.onResolve({ filter: /^\.\/ui$/ }, () => ({ path: 'ui', namespace: 'stub' }));
    build.onLoad({ filter: /.*/, namespace: 'stub' }, ({ path }) => ({ contents: path === 'host' ? `
      export class TFile { constructor(path) { this.path=path; this.basename='New'; this.extension='md'; this.stat={ctime:100}; } }
      globalThis.__PruneApiFile=TFile;
      export class MarkdownView {} export class Modal {} export class Notice {}
      export const parseYaml=JSON.parse; export const parseFrontMatterAliases=()=>[];
    ` : `export class TypePicker {}
      export class CreateNodeModal {
        constructor(app,index,schema,created) { this.created=created; app.dialog=this; }
        open() {} close() {}
      }` }));
  } }] });
const { PublicNodesApi, PruneManager } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
const tick = () => new Promise(resolve => setImmediate(resolve));
for (const mode of ['pristine', 'authored', 'edited', 'existing', 'other-link']) test(`API creation uses real Nodes pruning: ${mode}`, async () => {
  const File = globalThis.__PruneApiFile;
  const source = new File('Reading/Article.md'), node = new File('Nodes/New.md'), schema = new File('Schemas/person.md');
  const files = new Map([source, node, schema].map(file => [file.path, file]));
  const raw = '---\n{"type":"person"}\n---\n# New';
  const contents = new Map([[source.path, 'words'], [node.path, raw]]), trashed = [];
  const app = { vault: {
    getMarkdownFiles: () => [schema], getAbstractFileByPath: path => files.get(path),
    cachedRead: async () => '---\n{"nodeSchema":1,"nodeType":"person","properties":{}}\n---\n# {{title}}',
    read: async file => contents.get(file.path), trash: async file => { trashed.push(file.path); files.delete(file.path); },
  }, metadataCache: { resolvedLinks: {}, unresolvedLinks: {}, getFileCache: () => ({}) }, workspace: { iterateAllLeaves() {} } };
  const settings = { nodesFolder: 'Nodes', schemasFolder: 'Schemas', cleanupOrphans: true };
  const prune = new PruneManager(app, () => settings, async () => {});
  const api = new PublicNodesApi(app, { setFolder() {}, all: () => [] }, () => settings, prune);
  try {
    const link = async () => { contents.set(source.path, '==[[Nodes/New.md|words]]=='); app.metadataCache.resolvedLinks[source.path] = { [node.path]: 1 }; };
    if (mode === 'existing') await link();
    else {
      const pending = api.createNodeForLink({ type: 'person', sourcePath: source.path }, link);
      await tick(); app.dialog.created(node, raw, mode !== 'authored'); await pending;
    }
    prune.onResolved();
    contents.set(source.path, 'words'); app.metadataCache.resolvedLinks = {};
    if (mode === 'edited') contents.set(node.path, raw + '\nAuthored note');
    if (mode === 'other-link') app.metadataCache.resolvedLinks['Other.md'] = { [node.path]: 1 };
    prune.onResolved(); await prune.sweep();
    assert.deepEqual(trashed, mode === 'pristine' ? [node.path] : []);
    if (mode !== 'pristine') assert.equal(files.get(node.path), node);
  } finally { api.dispose(); prune.dispose(); }
});
