import { build } from 'esbuild';

const { outputFiles } = await build({
  stdin: { contents: `export { PublicNodesApi } from './src/api'; export { CaptureController } from './src/capture';
    export { NodeIndex } from './src/index'; export { createTypedNote } from './src/creation';
    export { TFile, TFolder, notices, Platform, iconCalls } from 'obsidian';`, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'capture-host', setup(build) {
    build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'host', namespace: 'stub' }));
    // Exercise real completion orchestration; its field widgets have their own UI suite.
    build.onResolve({ filter: /^\.\/required-ui-modal$/ }, () => ({ path: 'required-modal', namespace: 'stub' }));
    build.onLoad({ filter: /.*/, namespace: 'stub' }, ({ path }) => ({ contents: path === 'required-modal' ? `
      import { Modal } from 'obsidian';
      export class RequiredModal extends Modal {
        constructor(app, backend, path, fields, session) { super(app); Object.assign(this, { path, fields, session }); }
        onClose() { this.session.close(); }
      }
    ` : `
      export class TFile { constructor(path) { this.path = path; this.basename = path.split('/').pop().replace(/\\.md$/, ''); this.extension = 'md'; } }
      export class TFolder { constructor(path) { this.path = path; } }
      export const notices = [];
      export class Notice { constructor(message) { notices.push(message); } }
      export const Platform = { isMobile: false };
      export const iconCalls = [];
      function element(owner, text = '', ownerDocument = { defaultView: { matchMedia: () => ({ matches: false }) } }) {
        return { owner, text, ownerDocument, attributes: {},
          style: { setProperty(name, value) { this[name] = value; } }, children: [],
          setText(value) { this.text = value; }, setAttribute(name, value) { this.attributes[name] = value; },
          get textContent() { return this.text + this.children.map(child => child.textContent).join(''); },
          createEl(tag, options = {}) { const el = element(owner, options.text, this.ownerDocument); el.tag = tag; el.attributes = options.attr ?? {}; this.children.push(el); return el; },
          createSpan(options) { return this.createEl('span', options); } };
      }
      export class Modal {
        constructor(app) { this.app = app; this.scope = { register() {} }; this.inputs = []; this.buttons = []; this.contentEl = element(this); }
        open() { this.app.dialog = this; this.app.dialogs.push(this); this.onOpen?.(); }
        close() { if (this.closed) return; this.closed = true; this.onClose?.(); }
      }
      export class SuggestModal extends Modal {
        constructor(app) { super(app); this.inputEl = { value: '', dispatchEvent: () => {} }; }
        onOpen() {} onClose() {}
        setPlaceholder(value) { this.placeholder = value; }
      }
      export class AbstractInputSuggest { constructor(app, inputEl) { this.app = app; this.inputEl = inputEl; } setValue(value) { this.value = value; } close() {} }
      export class PluginSettingTab {}
      export const setIcon = (el, icon) => { el.icon = icon; iconCalls.push({ el, icon }); };
      export class Setting {
        constructor(el) { this.owner = el.owner; }
        setName() { return this; } setDesc() { return this; }
        addText(add) {
          const input = { inputEl: { focus() {} }, setValue(value) { this.value = value; return this; }, onChange(change) { this.change = change; return this; } };
          this.owner.inputs.push(input); add(input); return this;
        }
        addButton(add) {
          const button = { setButtonText(label) { this.label = label; return this; }, setCta() { return this; }, onClick(click) { this.click = click; return this; } };
          this.owner.buttons.push(button); add(button); return this;
        }
      }
      export const parseFrontMatterAliases = meta => { const aliases = meta?.aliases; return typeof aliases === 'string' ? [aliases] : aliases ?? []; };
      export const stringifyYaml = obj => Object.entries(obj).map(([key, value]) => key + ': ' + JSON.stringify(value)).join('\\n');
      export const prepareFuzzySearch = query => label => label.toLowerCase().includes(query.toLowerCase()) ? { score: -label.length } : null;
    ` }));
  } }],
});
export const { PublicNodesApi, CaptureController, NodeIndex, createTypedNote, TFile, TFolder, notices, Platform, iconCalls } =
  await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`);
export const tick = () => new Promise(resolve => setImmediate(resolve));
export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export function fixture() {
  const files = new Map(), contents = new Map(), metadata = new Map(), events = [], hooks = {};
  const state = { token: {}, connected: true, types: [{ name: 'person', icon: 'user-round' }, { name: 'author', icon: 'notebook-pen' }], members: [] };
  const settings = { nodesFolder: 'Nodes', classProperty: 'fileClass', trigger: '@' };
  const counts = { writes: 0, folders: 0, types: 0, members: 0, metadata: 0, required: 0, forbidden: 0 };
  function add(path, content = '', frontmatter) {
    const file = new TFile(path); files.set(path, file); contents.set(path, content);
    if (frontmatter) metadata.set(file, { frontmatter });
    return file;
  }
  const forbidden = () => { counts.forbidden++; throw new Error('No editor, pruning, overwrite, or raw vault scanning allowed'); };
  const app = {
    dialogs: [], workspace: new Proxy({}, { get: forbidden }),
    vault: {
      getAbstractFileByPath: path => files.get(path) ?? null,
      getMarkdownFiles: forbidden, delete: forbidden, trash: forbidden, modify: forbidden, process: forbidden,
      async read(file) { return contents.get(file.path); },
      async createFolder(path) {
        counts.folders++; events.push('folder'); await hooks.folder?.(path);
        if (files.has(path)) throw new Error('Folder collision');
        files.set(path, new TFolder(path));
      },
      async create(path, content) {
        counts.writes++; events.push('write:start'); await hooks.write?.(path, content);
        if (files.has(path)) throw new Error('File collision');
        const file = add(path, content); events.push('write:done'); await hooks.created?.(file);
        return file;
      },
    },
    metadataCache: { getFileCache(file) { counts.metadata++; return metadata.get(file) ?? null; } },
  };
  const backend = {
    token: () => state.token,
    async types() { counts.types++; return hooks.types ? hooks.types() : state.types; },
    async members() { counts.members++; return state.members; },
    async classesFor(path) { events.push('binding'); return hooks.classes ? hooks.classes(path) : ['person']; },
    async requiredFields(path) { counts.required++; events.push('required'); return hooks.required ? hooks.required(path) : []; },
    choices: async () => [], setValue: forbidden,
  };
  const index = new NodeIndex(app, () => backend.members());
  const capture = new CaptureController(app, backend, index, () => settings);
  const api = new PublicNodesApi(app, index, () => state.types, capture, () => state.connected, backend);
  function submit(title) {
    const dialog = app.dialog;
    if (title !== undefined) { dialog.inputs[0].value = title; dialog.inputs[0].change(title); }
    dialog.buttons.find(button => button.label === 'Create').click();
  }
  return { api, app, backend, capture, index, state, settings, files, contents, metadata, events, hooks, counts, add, submit };
}
export async function start(f, options = {}, link) {
  const args = { type: 'person', suggestedTitle: 'Ada', ...options };
  const pending = link ? f.api.createNodeForLink(args, link) : f.api.createNode(args);
  await tick();
  if (f.app.dialog?.buttons.some(button => button.label === 'Create') && !f.app.dialog.closed) f.submit();
  return { pending };
}
