import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const { outputFiles } = await build({
  stdin: { contents: "export { FolderSuggest } from './src/settings'; export { TFolder } from 'obsidian';", resolveDir: process.cwd() },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'obsidian-stub', setup(build) {
    build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'stub' }));
    build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: `
      export class AbstractInputSuggest {
        constructor(app, inputEl) { this.app = app; this.inputEl = inputEl; }
        setValue(value) { this.value = value; }
        close() { this.closed = true; }
      }
      export class App {}
      export class PluginSettingTab {}
      export class Setting {}
      export class TFolder { constructor(path) { this.path = path; } }
    ` }));
  } }],
});
const { FolderSuggest, TFolder } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`);

test('capture folder picker lists matching vault folders and hides Obsidian internals', () => {
  const folders = [new TFolder('Projects'), new TFolder('Archive/Projects'), new TFolder('Notes'), new TFolder('.obsidian'), new TFolder('.obsidian/plugins')];
  const suggest = new FolderSuggest({ vault: { getAllLoadedFiles: () => folders } }, {});
  assert.deepEqual(suggest.getSuggestions('project').map(folder => folder.path), ['Archive/Projects', 'Projects']);
  suggest.selectSuggestion(folders[0]);
  assert.equal(suggest.value, 'Projects');
  assert.equal(suggest.closed, true);
});
