import { Editor, EditorSuggest, type EditorSuggestContext, type EditorSuggestTriggerInfo, type EditorPosition, Modal, Notice, Plugin, TFile } from 'obsidian';
import { loadSchemas } from './schema';
import { NodeIndex, type NodeHit } from './index';
import { CreateNodeModal, TypePicker } from './ui';
import { LinkPicker, type LinkChoice } from './link-picker';
import { capture, insertLink, type Origin } from './references';
import { atTrigger } from './trigger';

type InlineChoice = { kind: 'existing'; hit: NodeHit } | { kind: 'create'; title: string };

class AtSuggest extends EditorSuggest<InlineChoice> {
  constructor(app: NodesPlugin['app'], private plugin: NodesPlugin) { super(app); this.limit = 21; }
  onTrigger(cursor: EditorPosition, editor: Editor, _file: TFile | null): EditorSuggestTriggerInfo | null {
    return atTrigger(editor, cursor);
  }
  getSuggestions(context: EditorSuggestContext): InlineChoice[] {
    const items: InlineChoice[] = this.plugin.index.search(context.query, 20).map(hit => ({ kind: 'existing', hit }));
    if (context.query.trim()) items.push({ kind: 'create', title: context.query.trim() });
    return items;
  }
  renderSuggestion(choice: InlineChoice, el: HTMLElement): void {
    if (choice.kind === 'create') { el.createEl('div', { text: `Create “${choice.title}”…` }); return; }
    el.createEl('div', { text: choice.hit.label });
    el.createEl('small', { text: `${choice.hit.entry.type} · ${choice.hit.entry.file.path}` });
  }
  selectSuggestion(choice: InlineChoice): void {
    const context = this.context;
    this.close();
    if (!context?.file) return;
    const origin = capture(context.editor, context.file, context.start, context.end);
    if (choice.kind === 'existing') insertLink(this.app, origin, choice.hit.entry.file, choice.hit.label);
    else void this.plugin.startCreate(choice.title, origin);
  }
}

export default class NodesPlugin extends Plugin {
  index!: NodeIndex;
  override onload(): void {
    this.index = new NodeIndex(this.app);
    this.app.workspace.onLayoutReady(() => this.index.rebuild());
    this.registerEvent(this.app.metadataCache.on('changed', file => { if (file.path.startsWith('Nodes/')) this.index.rebuild(); }));
    this.registerEvent(this.app.vault.on('create', file => { if (file.path.startsWith('Nodes/')) this.index.rebuild(); }));
    this.registerEvent(this.app.vault.on('delete', file => { if (file.path.startsWith('Nodes/')) this.index.rebuild(); }));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      if (file.path.startsWith('Nodes/') || oldPath.startsWith('Nodes/')) this.index.rebuild();
    }));
    this.registerEditorSuggest(new AtSuggest(this.app, this));
    this.addCommand({ id: 'create-node', name: 'Create node', callback: () => { void this.startCreate(''); } });
    this.addCommand({ id: 'create-or-link-node', name: 'Create or link node', editorCallback: (editor, view) => {
      if (view.file) this.startLink(editor, view.file);
      else new Notice('Open a Markdown note first');
    } });
    this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor, view) => {
      if (view.file) menu.addItem(item => item.setTitle('Create or link node').setIcon('link').onClick(() => this.startLink(editor, view.file!)));
    }));
    this.addCommand({ id: 'check-schemas', name: 'Check schemas', callback: () => { void this.showDiagnostics(); } });
  }
  private startLink(editor: Editor, file: TFile): void {
    const from = editor.getCursor('from'), to = editor.getCursor('to');
    const origin = capture(editor, file, from, to);
    if (/\r|\n|[\[\]|]/.test(origin.source)) { new Notice('Select a single line without link delimiters'); return; }
    new LinkPicker(this.app, this.index, (choice: LinkChoice) => {
      if (choice.kind === 'existing') insertLink(this.app, origin, choice.hit.entry.file, origin.source || choice.hit.label);
      else void this.startCreate(choice.title, origin, origin.source || undefined);
    }, origin.source).open();
  }
  async startCreate(seed: string, origin?: Origin, label?: string): Promise<void> {
    const { schemas, diagnostics } = await loadSchemas(this.app);
    if (diagnostics.length) new Notice(`Nodes: ${diagnostics.length} schema issue(s). Run “Check schemas” for details.`);
    if (!schemas.length) { new Notice('No valid node schemas in Schemas/. Run “Check schemas”.'); return; }
    new TypePicker(this.app, schemas, schema => {
      new CreateNodeModal(this.app, this.index, schema, file => {
        if (origin) insertLink(this.app, origin, file, label ?? file.basename);
        else void this.app.workspace.getLeaf(true).openFile(file).catch(error => new Notice(`Created ${file.path}; could not open it: ${String(error)}`));
      }, seed).open();
    }).open();
  }
  private async showDiagnostics(): Promise<void> {
    const catalog = await loadSchemas(this.app);
    const modal = new Modal(this.app);
    modal.contentEl.createEl('h2', { text: 'Node schemas' });
    modal.contentEl.createEl('p', { text: `${catalog.schemas.length} usable type(s), ${catalog.diagnostics.length} issue(s)` });
    for (const issue of catalog.diagnostics) modal.contentEl.createEl('p', { text: `${issue.path}: ${issue.message}` });
    modal.open();
  }
}
