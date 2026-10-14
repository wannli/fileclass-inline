import { build } from 'esbuild';

const bundle = await build({ stdin: { contents: "export * from './src/required-ui'; export { TFile } from 'obsidian'; export { MetadataPendingError } from './src/fileclass-contract';", resolveDir: process.cwd() },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'obsidian-dom', setup(build) {
    build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'host', namespace: 'stub' }));
    build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: `
      class Element {
        constructor(tag = 'div', options = {}, ownerDocument = { activeElement: null, focusCalls: [] }) {
          this.ownerDocument = ownerDocument;
          this.tag = tag; this.children = []; this.text = options.text || ''; this.style = {};
          this.attrs = options.attr || {}; this.type = options.type; this.listeners = {};
        }
        createEl(tag, options) { const el = new Element(tag, options, this.ownerDocument); this.children.push(el); return el; }
        createDiv(options) { return this.createEl('div', options); }
        createSpan(options) { return this.createEl('span', options); }
        empty() {
          if (this.children.some(child => child.contains(this.ownerDocument.activeElement))) this.ownerDocument.activeElement = null;
          this.children = []; if (this.control?.kind === 'select') this.control.options = {};
        }
        contains(el) { return this === el || this.children.some(child => child.contains(el)); }
        querySelector(selector) {
          for (const child of this.children) {
            if (selector.split(',').some(part => part.trim().startsWith(child.tag + ':') && !child.disabled && child.type !== 'hidden')) return child;
            const found = child.querySelector(selector); if (found) return found;
          }
          return null;
        }
        setText(text) { this.text = text; }
        setAttribute(name, value) { this.attrs[name] = value; }
        addEventListener(name, fn) { this.listeners[name] = fn; }
        focus(options) {
          if (this.disabled) return;
          globalThis.requiredFocused = this; this.ownerDocument.activeElement = this; this.ownerDocument.focusCalls.push({ el: this, options });
        }
      }
      class Control {
        constructor(parent, kind) {
          this.kind = kind; this.el = parent.createEl(kind); this.el.control = this; this.options = {};
          this.inputEl = this.el; this.buttonEl = this.el; this.selectEl = this.el;
        }
        setValue(value) { this.el.value = value; return this; }
        setPlaceholder(value) { this.el.placeholder = value; return this; }
        setDisabled(value) { this.el.disabled = value; return this; }
        setButtonText(value) { this.el.text = value; return this; }
        setCta() { return this; } setTooltip() { return this; }
        addOption(value, label) { this.options[value] = label; return this; }
        onChange(fn) { this.change = fn; return this; }
        onClick(fn) { this.click = fn; return this; }
      }
      export class Setting {
        constructor(parent) { this.settingEl = parent.createDiv(); this.settingEl.setting = this; this.controlEl = this.settingEl.createDiv(); }
        setName(value) { this.name = value; this.settingEl.createSpan({ text: value }); return this; }
        setDesc(value) { (this.descEl ||= this.settingEl.createSpan()).setText(value); return this; }
        add(kind, fn) { fn(new Control(this.controlEl, kind)); return this; }
        addText(fn) { return this.add('input', fn); }
        addTextArea(fn) { return this.add('textarea', fn); }
        addDropdown(fn) { return this.add('select', fn); }
        addButton(fn) { return this.add('button', fn); }
      }
      export class Modal {
        constructor(app) { this.app = app; this.contentEl = new Element(); this.keys = []; this.scope = { register: (...args) => this.keys.push(args) }; }
        open() { this.app.dialog = this; this.app.opened++; this.onOpen?.(); this.contentEl.querySelector('button:not([disabled])')?.focus(); }
        close() { if (this.closed) return; this.closed = true; this.app.closed++; this.onClose?.(); }
      }
      export class TFile { constructor(path) { this.path = path; } }
      export class Notice { constructor(text) { (globalThis.requiredNotices ||= []).push(text); } }
    ` }));
  } }] });
export const { completeRequiredFields, TFile, MetadataPendingError } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
export const tick = () => new Promise(resolve => setImmediate(resolve));
export function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
export const field = (name, type = 'Input', extra = {}) => ({ name, owner: 'Task', type, value: undefined, options: {}, supported: true, ...extra });
export function fixture(fields = []) {
  const state = { fields, target: new TFile('Nodes/New.md'), issued: [], choiceRequests: [], values: new Map(), token: {}, events: [], choices: {}, writes: [] };
  const app = { opened: 0, closed: 0, vault: { getAbstractFileByPath: path => state.target?.path === path ? state.target : null } };
  const bindings = new WeakMap();
  const checkBinding = descriptor => { if (!bindings.has(descriptor) || bindings.get(descriptor) !== state.target) throw Error('Original issued descriptor required'); };
  const backend = {
    token: () => state.token,
    types() { throw Error('Unrelated type lookup'); }, members() { throw Error('Unrelated member lookup'); },
    classesFor() { throw Error('Unrelated class lookup'); },
    async requiredFields(path) {
      state.events.push(['required', path]);
      const descriptors = state.fields.filter(f => !state.values.has(f.name)).map(f => structuredClone(f));
      for (const descriptor of descriptors) bindings.set(descriptor, state.target);
      state.issued.push(descriptors); return descriptors;
    },
    async choices(path, f) { checkBinding(f); state.choiceRequests.push(f); state.events.push(['choices', f.name]); return state.choices[f.name] || []; },
    async setValue(path, f, value, signal) {
      checkBinding(f); state.events.push(['write', f.name]); state.writes.push({ path, field: f, value, signal }); state.values.set(f.name, value);
    },
  };
  return { app, state, backend, start: signal => completeRequiredFields(app, backend, 'Nodes/New.md', signal) };
}
export function walk(el) { return [el, ...el.children.flatMap(walk)]; }
export function text(app) { return walk(app.dialog.contentEl).map(el => el.text).join('\n'); }
export function row(app, name) { return walk(app.dialog.contentEl).find(el => el.setting?.name === `${name} *`); }
export function controls(app, name) { return walk(row(app, name)).filter(el => el.control || el.type === 'checkbox'); }
export function input(app, name, value) {
  const el = controls(app, name)[0]; el.value = value; el.control.change(value); return el;
}
export function button(app, name) { return walk(app.dialog.contentEl).find(el => el.tag === 'button' && el.text === name).control; }
export const save = app => button(app, 'Save required values').click();
export function check(app, name, label) {
  const el = controls(app, name).find(el => el.attrs['aria-label'] === label);
  el.checked = true; el.listeners.change();
}
