import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundled = await build({ entryPoints: ['src/references.ts', 'src/trigger.ts'], bundle: true, format: 'esm', platform: 'node', outdir: 'out', write: false,
  plugins: [{ name: 'host', setup(build) {
    build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'host' }));
    build.onLoad({ filter: /.*/, namespace: 'host' }, () => ({ contents: 'export class Notice { constructor(text) {} }' }));
  } }],
});
const load = name => import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles.find(file => file.path.endsWith(name)).contents).toString('base64')}`);
const { capture, insertLink } = await load('references.js');
const { atTrigger } = await load('trigger.js');

test('stale editor never replaces text; correct origin inserts exactly once', () => {
  let content = 'See Ada.';
  const file = { path: 'Today.md' };
  const editor = { getValue: () => content, getRange: ({ ch: a }, { ch: b }) => content.slice(a, b), replaceRange: (text, { ch: a }, { ch: b }) => { content = content.slice(0, a) + text + content.slice(b); } };
  const app = { workspace: { activeEditor: { editor, file } }, fileManager: { generateMarkdownLink: (_target, _source, _subpath, label) => `[[Nodes/Ada|${label}]]` } };
  const origin = capture(editor, file, { line: 0, ch: 4 }, { line: 0, ch: 7 });
  content = 'See Bob.';
  assert.equal(insertLink(app, origin, { path: 'Nodes/Ada.md' }, 'Ada'), false);
  assert.equal(content, 'See Bob.');
  content = 'See Ada.';
  assert.equal(insertLink(app, origin, { path: 'Nodes/Ada.md' }, 'Ada'), true);
  assert.equal(content, 'See [[Nodes/Ada|Ada]].');
  content = 'See Ada.';
  assert.equal(insertLink(app, capture(editor, file, { line: 0, ch: 4 }, { line: 0, ch: 7 }), { path: 'Nodes/Ada.md' }, 'Ada', 'green'), true);
  assert.equal(content, 'See ==🟢[[Nodes/Ada|Ada]]==.');
});

test('trigger accepts punctuation boundary but ignores email and frontmatter', () => {
  const editor = text => ({ somethingSelected: () => false, getLine: () => text, getValue: () => text });
  assert.equal(atTrigger(editor('by @Ada)'), { line: 0, ch: 8 }), null);
  assert.equal(atTrigger(editor('by @Ada'), { line: 0, ch: 7 })?.query, 'Ada');
  assert.equal(atTrigger(editor('name@example'), { line: 0, ch: 12 }), null);
});
