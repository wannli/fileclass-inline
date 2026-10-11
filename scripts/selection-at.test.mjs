import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ entryPoints: ['src/selected-text.ts', 'src/selection-at.ts'], outdir: 'out', bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'host', setup(build) {
    build.onResolve({ filter: /^obsidian$|^@codemirror\/view$/ }, args => ({ path: args.path, namespace: 'stub' }));
    build.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: args.path === 'obsidian'
      ? 'export class MarkdownView {}; export class Notice {}'
      : 'export class EditorView { static inputHandler = { of: fn => fn }; }' }));
  } }],
});
const load = name => import(`data:text/javascript;base64,${Buffer.from(output.outputFiles.find(file => file.path.endsWith(name)).contents).toString('base64')}`);
const { planSelection } = await load('selected-text.js');
const { isSelectedTriggerInput, selectedAtExtension } = await load('selection-at.js');

test('selection + @ prevents replacement; ordinary typing and IME do not', async () => {
  const source = 'Ada Lvl', file = { path: 'Try Nodes.md' };
  const editor = { getValue: () => source, getSelection: () => source,
    getCursor: side => ({ line: 0, ch: side === 'from' ? 0 : source.length }),
    getRange: () => source };
  const view = { composing: false, state: { selection: { main: { from: 0, to: 7 }, ranges: [{}] }, doc: { sliceString: () => source } }, dom: {} };
  const markdown = { file, editor, contentEl: { contains: node => node === view.dom } };
  const app = { workspace: { activeEditor: { file, editor }, getActiveViewOfType: () => markdown } };
  const opened = [];
  const handler = selectedAtExtension(app, () => '@', origin => opened.push(origin.source));
  assert.equal(isSelectedTriggerInput(view, 0, 7, '@', '@'), true);
  assert.equal(handler(view, 0, 7, '@'), true);
  await Promise.resolve();
  assert.deepEqual(opened, [source]);
  assert.equal(handler(view, 0, 7, 'x'), false);
  view.composing = true;
  assert.equal(handler(view, 0, 7, '@'), false);
});

test('multi-line selection keeps its full body and uses the first line as draft title', () => {
  assert.deepEqual(planSelection('Idea\nsecond line'), { query: 'Idea', body: 'Idea\nsecond line' });
  assert.deepEqual(planSelection('Ada Lvl'), { query: 'Ada Lvl', label: 'Ada Lvl' });
});
