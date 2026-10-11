import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const { outputFiles } = await build({ entryPoints: ['src/ui.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'host', setup(build) {
    build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'host' }));
    build.onLoad({ filter: /.*/, namespace: 'host' }, () => ({ contents: `
      export class Modal { constructor(app) { this.app = app; this.scope = { register() {} }; this.contentEl = {}; } }
      export class SuggestModal {}
      export class Setting {
        constructor() { globalThis.settings.push(this); this.buttons = 0; this.texts = 0; }
        setName() { return this; } setDesc() { return this; }
        addButton() { this.buttons++; return this; } addText() { this.texts++; return this; }
        addDropdown(callback) {
          const dropdown = { options: [], addOption(value, label) { this.options.push({ value, label }); return this; },
            setValue(value) { this.value = value; return this; }, onChange(fn) { this.change = fn; return this; } };
          callback(dropdown); this.dropdown = dropdown; return this;
        }
      }
      export class Notice {} export class TFile {} export class TFolder {}
      export const prepareFuzzySearch = () => () => null, parseFrontMatterAliases = () => [], parseYaml = () => ({}), stringifyYaml = () => '';
    ` }));
  } }],
});
const { CreateNodeModal } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`);

test('typed links use one name-only dropdown, with no separate clear button', () => {
  globalThis.settings = [];
  const project = { type: 'project', file: { path: 'Nodes/UNGA.md', basename: 'UNGA' } };
  const person = { type: 'person', file: { path: 'Nodes/Ada Lovelace.md', basename: 'Ada Lovelace' } };
  const app = { metadataCache: { getFirstLinkpathDest: path => ['Nodes/UNGA', 'UNGA'].includes(path) ? project.file :
    path === 'Ada Lovelace' ? person.file : null,
    fileToLinktext: file => file.basename } };
  const modal = new CreateNodeModal(app, { all: () => [project, person] }, { properties: {} }, () => {});
  modal.addField('project', { kind: 'link', targetType: 'project', requiredOnCreate: true, default: '[[Nodes/UNGA]]' });
  modal.addField('assignee', { kind: 'link', targetType: 'person' });
  const [projectSetting, assigneeSetting] = globalThis.settings;
  assert.deepEqual(projectSetting.dropdown.options, [{ value: '', label: 'Choose project…' }, { value: 'Nodes/UNGA.md', label: 'UNGA' }]);
  assert.equal(projectSetting.dropdown.value, 'Nodes/UNGA.md');
  assert.deepEqual(assigneeSetting.dropdown.options, [{ value: '', label: 'Not set' }, { value: 'Nodes/Ada Lovelace.md', label: 'Ada Lovelace' }]);
  assert.equal(projectSetting.buttons + assigneeSetting.buttons + projectSetting.texts + assigneeSetting.texts, 0);
  projectSetting.dropdown.change('Nodes/UNGA.md');
  assert.equal(modal.values.project, '[[UNGA]]');
  assigneeSetting.dropdown.change('Nodes/Ada Lovelace.md');
  assert.equal(modal.values.assignee, '[[Ada Lovelace]]'); // Stored link, not displayed in the dropdown.
  assigneeSetting.dropdown.change('');
  assert.equal(modal.values.assignee, '');
});
