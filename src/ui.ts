import { App, type ButtonComponent, Modal, Notice, Setting, SuggestModal, TFile } from 'obsidian';
import { loadSchemas, type NodeSchema, type Field } from './schema';
import { NodeIndex } from './index';
import { createNode, inferableOnly, resolved, titleError, validateValues, type Values } from './create';
import { shortestWikiLink } from './links';

export class TypePicker extends SuggestModal<NodeSchema> {
  constructor(app: App, private schemas: NodeSchema[], private choose: (schema: NodeSchema) => void, private dismissed?: () => void) {
    super(app); this.setPlaceholder('Choose a node type'); this.shouldRestoreSelection = false;
  }
  getSuggestions(query: string): NodeSchema[] { return this.schemas.filter(schema => `${schema.label} ${schema.nodeType}`.toLowerCase().includes(query.toLowerCase())); }
  renderSuggestion(schema: NodeSchema, el: HTMLElement): void { el.setText(schema.label); }
  onChooseSuggestion(schema: NodeSchema): void { this.choose(schema); }
  onClose(): void { queueMicrotask(() => this.dismissed?.()); }
}

export class CreateNodeModal extends Modal {
  private title: string;
  private values: Values = Object.create(null);
  private pending = false;
  private errorEl?: HTMLElement;
  private createButton?: ButtonComponent;
  constructor(app: App, private index: NodeIndex, private schema: NodeSchema, private created: (file: TFile, content: string, inferable: boolean) => void, title = '', private folder = 'Nodes', private schemaFolder = 'Schemas', private selectedBody?: string, private dismissed?: () => void, private isActive: () => boolean = () => true) {
    super(app); this.title = title; this.shouldRestoreSelection = false;
    for (const modifier of ['Ctrl', 'Meta'] as const) this.scope.register([modifier], 'Enter', () => {
      void this.submit();
      return false;
    });
  }
  onClose(): void { this.dismissed?.(); }
  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.createEl('h2', { text: `Create ${this.schema.label}` });
    if (this.selectedBody) this.contentEl.createEl('p', { text: 'Selected text will be copied into the new node before the source becomes a link.' });
    new Setting(this.contentEl).setName('Name').setDesc(`File in ${this.folder}/`).addText(input => {
      input.setValue(this.title).setPlaceholder('Node name').onChange(value => { this.title = value; }); input.inputEl.focus();
    });
    const fields = Object.entries(this.schema.properties).sort((a, b) => Number(!!b[1].requiredOnCreate) - Number(!!a[1].requiredOnCreate));
    for (const [name, field] of fields) this.addField(name, field);
    this.errorEl = this.contentEl.createEl('p', { cls: 'mod-warning', attr: { role: 'alert' } });
    new Setting(this.contentEl).addButton(button => {
      this.createButton = button;
      button.setButtonText('Create').setCta().setTooltip('Ctrl+Enter or ⌘+Enter').onClick(() => this.submit());
    }).addButton(button => button.setButtonText('Cancel').onClick(() => {
      if (this.pending) { new Notice('Creation is in progress'); return; }
      this.close();
    }));
  }
  private async submit(): Promise<void> {
    if (!this.isActive() || this.pending || !this.errorEl || !this.createButton) return;
    const errors = [titleError(this.title), ...validateValues(this.schema, this.values)].filter(Boolean);
    if (errors.length) { this.errorEl.setText(errors.join('; ')); return; }
    this.pending = true;
    const button = this.createButton;
    const errorEl = this.errorEl;
    button.setDisabled(true);
    try {
      const fresh = await loadSchemas(this.app, this.schemaFolder);
      if (!this.isActive()) return;
      const current = fresh.schemas.find(schema => schema.path === this.schema.path && schema.nodeType === this.schema.nodeType);
      if (!current || JSON.stringify(current) !== JSON.stringify(this.schema)) throw new Error('Schema changed while the form was open; reopen the creation form');
      const beforeCommit = async (): Promise<void> => {
        const latest = await loadSchemas(this.app, this.schemaFolder);
        const final = latest.schemas.find(schema => schema.path === current.path && schema.nodeType === current.nodeType);
        if (!final || JSON.stringify(final) !== JSON.stringify(current)) throw new Error('Schema changed while the form was open; reopen the creation form');
        this.index.rebuild();
      };
      // Use the same immutable values for rendered bytes and cleanup eligibility,
      // even if inputs change while the vault write is pending.
      const values: Values = structuredClone(this.values);
      const inferable = inferableOnly(current, values, this.selectedBody);
      const { file, content } = await createNode(this.app, this.index, current, this.title, values, this.folder, this.selectedBody, this.isActive, beforeCommit);
      this.created(file, content, inferable); this.close();
    } catch (error) { errorEl.setText(`Could not create node: ${String(error)}`); }
    finally { this.pending = false; button.setDisabled(false); }
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
    } else if (field.kind === 'link') {
      const entries = this.index.all().filter(entry => !field.targetType || entry.type === field.targetType)
        .sort((a, b) => a.file.basename.localeCompare(b.file.basename) || a.file.path.localeCompare(b.file.path));
      const linkpath = typeof current === 'string' && current.startsWith('[[') && current.endsWith(']]')
        ? current.slice(2, -2).split('|')[0] : '';
      const target = linkpath ? this.app.metadataCache.getFirstLinkpathDest(linkpath, `${this.folder}/${this.title}.md`) : null;
      const selected = entries.some(entry => entry.file.path === target?.path) ? target!.path : '';
      const counts = new Map<string, number>();
      for (const entry of entries) counts.set(entry.file.basename, (counts.get(entry.file.basename) ?? 0) + 1);
      setting.addDropdown(dropdown => {
        dropdown.addOption('', field.requiredOnCreate ? `Choose ${name}…` : 'Not set');
        for (const entry of entries) {
          const parent = entry.file.parent?.path ?? '';
          const relativeFolder = parent.startsWith(`${this.folder}/`) ? parent.slice(this.folder.length + 1) : parent;
          dropdown.addOption(entry.file.path, counts.get(entry.file.basename)! > 1
            ? `${entry.file.basename} (${relativeFolder || 'root'})` : entry.file.basename);
        }
        dropdown.setValue(selected).onChange(path => {
          const file = entries.find(entry => entry.file.path === path)?.file;
          this.values[name] = file ? shortestWikiLink(this.app, file, `${this.folder}/${this.title}.md`) : '';
        });
      });
    } else if (field.kind === 'text-list') {
      setting.addTextArea(input => input.setPlaceholder('One per line').setValue(Array.isArray(current) ? current.join('\n') : '')
        .onChange(value => { this.values[name] = value.split('\n').map(line => line.trim()).filter(Boolean); }));
    } else setting.addText(input => {
      input.setValue(current === undefined ? '' : String(current)).setPlaceholder(field.kind).onChange(value => {
        this.values[name] = !value.trim() ? '' : field.kind === 'number' ? Number(value) : value;
      });
    });
  }
}
