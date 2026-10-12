import { Editor, EditorSuggest, type EditorSuggestContext, type EditorSuggestTriggerInfo, type EditorPosition, Modal, Notice, Plugin, Setting, TFile } from 'obsidian';
import { loadSchemas } from './schema';
import { NodeIndex, type NodeHit } from './index';
import { CreateNodeModal, TypePicker } from './ui';
import { LinkPicker, type LinkChoice } from './link-picker';
import { capture, insertLink, isOriginCurrent, type Origin } from './references';
import { selectedAtExtension } from './selection-at';
import { planSelection } from './selected-text';
import { atTrigger } from './trigger';
import { DEFAULT_SETTINGS, NodesSettingsTab, validateSettings, type NodesSettings } from './settings';
import { renderNodeSuggestion } from './suggestion-row';
import { PruneManager, type TrackedNode } from './prune';
import type { HighlightColor } from './highlight';
import { PublicNodesApi, type NodesApi } from './api';

type InlineChoice = { kind: 'existing'; hit: NodeHit } | { kind: 'create'; title: string };

class AtSuggest extends EditorSuggest<InlineChoice> {
  constructor(app: NodesPlugin['app'], private plugin: NodesPlugin) { super(app); this.limit = 21; }
  onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
    return file ? atTrigger(editor, cursor, this.plugin.settings.trigger) : null;
  }
  getSuggestions(context: EditorSuggestContext): InlineChoice[] {
    const items: InlineChoice[] = this.plugin.index.search(context.query, 20).map(hit => ({ kind: 'existing', hit }));
    if (context.query.trim()) items.push({ kind: 'create', title: context.query.trim() });
    return items;
  }
  renderSuggestion(choice: InlineChoice, el: HTMLElement): void {
    if (choice.kind === 'create') { el.createEl('div', { text: `Create “${choice.title}”…` }); return; }
    renderNodeSuggestion(choice.hit, el, this.plugin.colorForType(choice.hit.entry.type));
  }
  selectSuggestion(choice: InlineChoice): void {
    const context = this.context;
    this.close();
    if (!context?.file) return;
    const origin = capture(context.editor, context.file, context.start, context.end);
    if (choice.kind === 'existing') void this.plugin.linkExisting(origin, choice.hit, choice.hit.label);
    else void this.plugin.startCreate(choice.title, origin);
  }
}

export default class NodesPlugin extends Plugin {
  /** Optional integration surface. Consumers must check version before use. */
  private publicApi?: NodesApi;
  get api(): NodesApi | undefined { return this.publicApi; }
  index!: NodeIndex;
  private prune!: PruneManager;
  private saves: Promise<void> = Promise.resolve();
  private typeColors = new Map<string, HighlightColor>();
  private colorRefresh = 0;
  settings: NodesSettings = { ...DEFAULT_SETTINGS };
  override async onload(): Promise<void> {
    const stored = await this.loadData() as (Partial<NodesSettings> & { createdNodes?: Record<string, TrackedNode> }) | null;
    const candidate = { ...DEFAULT_SETTINGS, ...stored };
    if (!validateSettings(candidate)) this.settings = candidate;
    this.index = new NodeIndex(this.app, this.settings.nodesFolder);
    await this.refreshSchemaColors();
    this.prune = new PruneManager(this.app, () => this.settings, () => this.persist());
    this.prune.restore(stored?.createdNodes);
    const api = new PublicNodesApi(this.app, this.index, () => this.settings, this.prune);
    this.publicApi = api;
    this.register(() => { api.dispose(); this.publicApi = undefined; });
    this.addSettingTab(new NodesSettingsTab(this.app, this));
    this.app.workspace.onLayoutReady(() => { this.index.rebuild(); this.prune.onResolved(); void this.refreshSchemaColors(); });
    this.registerEvent(this.app.metadataCache.on('resolved', () => this.prune.onResolved()));
    this.registerEvent(this.app.workspace.on('layout-change', () => this.prune.onResolved()));
    this.register(() => this.prune.dispose());
    const inNodes = (path: string): boolean => path.startsWith(`${this.settings.nodesFolder}/`);
    const inSchemas = (path: string): boolean => path.startsWith(`${this.settings.schemasFolder}/`);
    this.registerEvent(this.app.metadataCache.on('changed', file => {
      if (inNodes(file.path)) this.index.rebuild();
      if (inSchemas(file.path)) void this.refreshSchemaColors();
    }));
    this.registerEvent(this.app.vault.on('create', file => {
      if (inNodes(file.path)) this.index.rebuild();
      if (inSchemas(file.path)) void this.refreshSchemaColors();
    }));
    this.registerEvent(this.app.vault.on('delete', file => {
      if (inNodes(file.path)) this.index.rebuild();
      if (inSchemas(file.path)) void this.refreshSchemaColors();
      this.prune.forget(file.path);
      this.prune.forgetBySource(file.path);
    }));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      if (inNodes(file.path) || inNodes(oldPath)) this.index.rebuild();
      if (inSchemas(file.path) || inSchemas(oldPath)) void this.refreshSchemaColors();
      this.prune.forget(oldPath);
      this.prune.forgetBySource(oldPath);
    }));
    this.registerEditorExtension(selectedAtExtension(this.app, () => this.settings.trigger, origin => this.startSelectedOrigin(origin)));
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
  colorForType(type: string): HighlightColor | undefined { return this.typeColors.get(type); }
  private async refreshSchemaColors(): Promise<void> {
    const request = ++this.colorRefresh;
    const { schemas } = await loadSchemas(this.app, this.settings.schemasFolder);
    if (request === this.colorRefresh) this.typeColors = new Map(schemas.flatMap(schema =>
      schema.highlight ? [[schema.nodeType, schema.highlight] as const] : []));
  }
  private persist(): Promise<void> {
    this.saves = this.saves.catch(() => {}).then(() => this.saveData({ ...this.settings, createdNodes: this.prune.entries() }));
    return this.saves;
  }
  async saveSettings(settings: NodesSettings): Promise<void> {
    this.settings = { ...settings };
    await this.persist();
    this.index.setFolder(settings.nodesFolder);
    await this.refreshSchemaColors();
    this.prune.onResolved();
  }
  private startLink(editor: Editor, file: TFile): void {
    this.startSelectedOrigin(capture(editor, file, editor.getCursor('from'), editor.getCursor('to')));
  }
  private startSelectedOrigin(origin: Origin): void {
    if (!isOriginCurrent(this.app, origin)) return;
    if (origin.source && !origin.source.trim()) { new Notice('Select text with a name to create or link a node'); return; }
    const plan = planSelection(origin.source);
    if (plan.body) {
      // Linking to an existing note would discard this multi-line content. Copy it into a new node instead.
      void this.startCreate(plan.query, origin, undefined, plan.body);
      return;
    }
    if (plan.label && /[\[\]|]/.test(plan.label)) { new Notice('Selection contains link delimiters; choose simpler text'); return; }
    if (plan.query && !this.index.search(plan.query).length) {
      void this.startCreate(plan.query, origin, plan.label);
      return;
    }
    new LinkPicker(this.app, this.index, (choice: LinkChoice) => {
      if (choice.kind === 'existing') void this.linkExisting(origin, choice.hit, plan.label || choice.hit.label);
      else void this.startCreate(choice.title, origin, plan.label);
    }, plan.query, type => this.colorForType(type)).open();
  }
  async linkExisting(origin: Origin, hit: NodeHit, label: string): Promise<void> {
    if (this.app.vault.getAbstractFileByPath(hit.entry.file.path) !== hit.entry.file) {
      new Notice('That node moved or was deleted; no link was inserted.');
      return;
    }
    const { schemas } = await loadSchemas(this.app, this.settings.schemasFolder);
    const type = this.index.all().find(entry => entry.file.path === hit.entry.file.path)?.type;
    const highlight = schemas.find(schema => schema.nodeType === type)?.highlight;
    insertLink(this.app, origin, hit.entry.file, label, highlight);
  }
  async startCreate(seed: string, origin?: Origin, label?: string, selectedBody?: string): Promise<void> {
    const { schemas, diagnostics } = await loadSchemas(this.app, this.settings.schemasFolder);
    if (diagnostics.length) new Notice(`Nodes: ${diagnostics.length} schema issue(s). Run “Check schemas” for details.`);
    if (!schemas.length) { new Notice(`No valid node schemas in ${this.settings.schemasFolder}/. Run “Check schemas”.`); return; }
    new TypePicker(this.app, schemas, schema => {
      new CreateNodeModal(this.app, this.index, schema, (file, content, inferable) => {
        if (origin) insertLink(this.app, origin, file, label ?? file.basename, schema.highlight, link => {
          if (inferable) this.prune.track(file, origin.path, link, content, schema);
        });
        else void this.app.workspace.getLeaf(true).openFile(file).catch(error => new Notice(`Created ${file.path}; could not open it: ${String(error)}`));
      }, seed, this.settings.nodesFolder, this.settings.schemasFolder, selectedBody).open();
    }).open();
  }
  private async showDiagnostics(): Promise<void> {
    const catalog = await loadSchemas(this.app, this.settings.schemasFolder);
    const modal = new Modal(this.app);
    modal.contentEl.createEl('h2', { text: 'Node schemas' });
    modal.contentEl.createEl('p', { text: `${catalog.schemas.length} usable type(s), ${catalog.diagnostics.length} issue(s)` });
    for (const issue of catalog.diagnostics) new Setting(modal.contentEl)
      .setName(issue.path).setDesc(issue.message).addButton(button => button.setButtonText('Open').onClick(async () => {
        const file = this.app.vault.getAbstractFileByPath(issue.path);
        if (file instanceof TFile) { modal.close(); await this.app.workspace.getLeaf(true).openFile(file); }
      }));
    modal.open();
  }
}
