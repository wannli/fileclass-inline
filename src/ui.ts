import { App, Modal, Notice, Setting, SuggestModal, TFile } from 'obsidian';
import { loadSchemas, type NodeSchema, type Field } from './schema';
import { NodeIndex, type NodeHit } from './index';
import { createNode, resolved, titleError, validateValues, type Values } from './create';
import { HIGHLIGHT_EMOJI } from './highlight';

export class TypePicker extends SuggestModal<NodeSchema> {
  constructor(app: App, private schemas: NodeSchema[], private choose: (schema: NodeSchema) => void) {
    super(app); this.setPlaceholder('Choose a node type');
  }
  getSuggestions(query: string): NodeSchema[] { return this.schemas.filter(schema => `${schema.label} ${schema.nodeType}`.toLowerCase().includes(query.toLowerCase())); }
  renderSuggestion(schema: NodeSchema, el: HTMLElement): void {
    el.createEl('div', { text: `${schema.highlight ? `${HIGHLIGHT_EMOJI[schema.highlight]} ` : ''}${schema.label}` });
    el.createEl('small', { text: schema.nodeType });
  }
  onChooseSuggestion(schema: NodeSchema): void { this.choose(schema); }
}

export class NodePicker extends SuggestModal<NodeHit> {
  constructor(app: App, private index: NodeIndex, private choose: (hit: NodeHit) => void, private type?: string, query = '') {
    super(app); this.setPlaceholder('Find a node'); this.inputEl.value = query;
  }
  getSuggestions(query: string): NodeHit[] { return this.index.search(query, 20, this.type); }
  renderSuggestion(hit: NodeHit, el: HTMLElement): void {
    el.createEl('div', { text: hit.label });
    el.createEl('small', { text: `${hit.entry.type} · ${hit.entry.file.path}` });
  }
  onChooseSuggestion(hit: NodeHit): void { this.choose(hit); }
}

export class CreateNodeModal extends Modal {
  private title: string;
  private values: Values = Object.create(null);
  private pending = false;
  constructor(app: App, private index: NodeIndex, private schema: NodeSchema, private created: (file: TFile) => void, title = '', private folder = 'Nodes', private schemaFolder = 'Schemas', private selectedBody?: string) {
    super(app); this.title = title;
  }
  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.createEl('h2', { text: `Create ${this.schema.highlight ? `${HIGHLIGHT_EMOJI[this.schema.highlight]} ` : ''}${this.schema.label}` });
    if (this.selectedBody) this.contentEl.createEl('p', { text: 'Selected text will be copied into the new node before the source becomes a link.' });
    new Setting(this.contentEl).setName('Name').setDesc(`File in ${this.folder}/`).addText(input => {
      input.setValue(this.title).setPlaceholder('Node name').onChange(value => { this.title = value; }); input.inputEl.focus();
    });
    const fields = Object.entries(this.schema.properties).sort((a, b) => Number(!!b[1].requiredOnCreate) - Number(!!a[1].requiredOnCreate));
    for (const [name, field] of fields) this.addField(name, field);
    const errorEl = this.contentEl.createEl('p', { cls: 'mod-warning', attr: { role: 'alert' } });
    new Setting(this.contentEl).addButton(button => button.setButtonText('Create').setCta().onClick(async () => {
      if (this.pending) return;
      const errors = [titleError(this.title), ...validateValues(this.schema, this.values)].filter(Boolean);
      if (errors.length) { errorEl.setText(errors.join('; ')); return; }
      this.pending = true; button.setDisabled(true);
      try {
        const fresh = await loadSchemas(this.app, this.schemaFolder);
        const current = fresh.schemas.find(schema => schema.path === this.schema.path && schema.nodeType === this.schema.nodeType);
        if (!current || JSON.stringify(current) !== JSON.stringify(this.schema)) throw new Error('Schema changed while the form was open; reopen the creation form');
        const file = await createNode(this.app, this.index, current, this.title, this.values, this.folder, this.selectedBody);
        this.close(); this.created(file);
      } catch (error) { errorEl.setText(`Could not create node: ${String(error)}`); }
      finally { this.pending = false; button.setDisabled(false); }
    })).addButton(button => button.setButtonText('Cancel').onClick(() => {
      if (this.pending) { new Notice('Creation is in progress'); return; }
      this.close();
    }));
  }
  private addField(name: string, field: Field): void {
    const setting = new Setting(this.contentEl).setName(`${name}${field.requiredOnCreate ? ' *' : ''}`).setDesc(field.targetType ? `Link to a ${field.targetType} node` : field.kind);
    const current = resolved(field, this.values, name);
    if (field.kind === 'checkbox') {
      setting.addDropdown(dropdown => dropdown.addOption('', 'Not set').addOption('true', 'Yes').addOption('false', 'No')
        .setValue(current === undefined ? '' : String(current))
        .onChange(value => { this.values[name] = value === '' ? '' : value === 'true'; }));
    } else if (field.kind === 'select') {
      setting.addDropdown(dropdown => {
        dropdown.addOption('', 'Not set');
        for (const option of field.options ?? []) dropdown.addOption(option, option);
        dropdown.setValue(typeof current === 'string' ? current : '');
        dropdown.onChange(value => { this.values[name] = value; });
      });
    } else if (field.kind === 'text-list') {
      setting.addTextArea(input => input.setPlaceholder('One per line').setValue(Array.isArray(current) ? current.join('\n') : '')
        .onChange(value => { this.values[name] = value.split('\n').map(line => line.trim()).filter(Boolean); }));
    } else {
      setting.addText(input => {
        input.setValue(current === undefined ? '' : String(current)).setPlaceholder(field.kind).onChange(value => {
          this.values[name] = !value.trim() ? '' : field.kind === 'number' ? Number(value) : value;
        });
        if (field.kind === 'link') {
          input.inputEl.readOnly = true;
          input.inputEl.setAttribute('aria-label', `Choose ${name} node`);
        }
      });
      if (field.kind === 'link') {
        setting.addButton(button => button.setButtonText('Choose…').onClick(() => {
          new NodePicker(this.app, this.index, hit => {
            this.values[name] = `[[${hit.entry.file.path.slice(0, -3)}]]`;
            this.onOpen();
          }, field.targetType).open();
        }));
        if (!field.requiredOnCreate) setting.addButton(button => button.setButtonText('Clear').onClick(() => {
          this.values[name] = '';
          this.onOpen();
        }));
      }
    }
  }
}
