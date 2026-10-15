import { Editor, Modal, Notice, Plugin, TFile } from 'obsidian';
import { NodeIndex, type NodeHit } from './index';
import { LinkPicker, type LinkChoice } from './link-picker';
import { capture, insertLink, isOriginCurrent, type Origin } from './references';
import { selectedAtExtension } from './selection-at';
import { planSelection } from './selected-text';
import { DEFAULT_SETTINGS, loadSettings, NodesSettingsTab, type NodesSettings } from './settings';
import { PublicNodesApi, type NodesApi } from './api';
import { FileclassBridge } from './fileclass';
import type { ClassInfo } from './fileclass-contract';
import { CaptureController } from './capture';
import { AtSuggest } from './at-suggest';
import { FileclassCache } from './fileclass-cache';

export default class NodesPlugin extends Plugin {
  private publicApi?: PublicNodesApi;
  get api(): NodesApi | undefined { return this.publicApi; }
  index!: NodeIndex;
  private backend!: FileclassBridge;
  private captures!: CaptureController;
  private cache!: FileclassCache;
  private live = false;
  private modals = new Set<Modal>();
  private saves: Promise<void> = Promise.resolve();
  settings: NodesSettings = { ...DEFAULT_SETTINGS };

  override async onload(): Promise<void> {
    this.settings = loadSettings(await this.loadData());
    this.live = true;
    this.backend = new FileclassBridge(this.app);
    this.index = new NodeIndex(this.app, () => this.backend.members());
    this.captures = new CaptureController(this.app, this.backend, this.index, () => this.settings);
    this.cache = new FileclassCache(this.app, this.backend, this.index, () => {
      this.publicApi?.cancelAll(); this.captures.cancelAll(); this.closeModals();
    });
    const api = new PublicNodesApi(this.app, this.index, () => this.cache.types(), this.captures, () => this.available(), this.backend);
    this.publicApi = api;
    this.register(() => {
      this.live = false; api.dispose(); this.cache.dispose(); this.closeModals(); this.index.dispose(); this.publicApi = undefined;
    });
    this.addSettingTab(new NodesSettingsTab(this.app, this));
    this.app.workspace.onLayoutReady(() => { if (this.live) this.cache.start(); });
    this.registerEditorExtension(selectedAtExtension(this.app, () => this.available() ? this.settings.trigger : '', origin => {
      if (this.available()) this.startSelectedOrigin(origin);
    }));
    this.registerEditorSuggest(new AtSuggest(this.app, this));
    this.addCommand({ id: 'create-node', name: 'Create node', callback: () => { void this.startCreate(''); } });
    this.addCommand({ id: 'create-or-link-node', name: 'Create or link node', editorCallback: (editor, view) => {
      if (view.file) this.startLink(editor, view.file); else new Notice('Open a Markdown note first');
    } });
    this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor, view) => {
      if (view.file) menu.addItem(item => item.setTitle('Create or link node').setIcon('link').onClick(() => this.startLink(editor, view.file!)));
    }));
    this.addCommand({ id: 'check-fileclass', name: 'Check Fileclass connection', callback: () => { void this.showStatus(); } });
  }
  available(): boolean {
    // Do not offer Create as if an uninitialized membership snapshot were an empty search.
    return this.live && this.cache.available() && this.cache.types().length > 0;
  }
  typeInfo(name: string): ClassInfo | undefined { return this.cache.typeInfo(name); }
  async saveSettings(settings: NodesSettings): Promise<void> {
    this.publicApi?.cancelAll(); this.captures.cancelAll(); this.closeModals(); this.settings = { ...settings };
    // Deliberately do not persist or restore legacy auto-pruning records.
    this.saves = this.saves.catch(() => {}).then(() => this.saveData({ ...this.settings }));
    await this.saves; await this.cache.refresh();
  }
  private startLink(editor: Editor, file: TFile): void {
    this.startSelectedOrigin(capture(editor, file, editor.getCursor('from'), editor.getCursor('to')));
  }
  private startSelectedOrigin(origin: Origin): void {
    if (!isOriginCurrent(this.app, origin)) return;
    if (!this.available()) { new Notice('FileClass Inline needs a ready Fileclass v1 index with at least one class. Run “Check Fileclass connection”.'); return; }
    if (origin.source && !origin.source.trim()) { new Notice('Select text with a name to create or link a node'); return; }
    const plan = planSelection(origin.source);
    if (plan.body) { void this.startCreate(plan.query, origin, undefined, plan.body); return; }
    if (plan.label && /[\[\]|]/.test(plan.label)) { new Notice('Selection contains link delimiters; choose simpler text'); return; }
    if (plan.query && !this.index.search(plan.query).length) { void this.startCreate(plan.query, origin, plan.label); return; }
    this.openModal(new LinkPicker(this.app, this.index, (choice: LinkChoice) => {
      if (!this.live) return;
      if (choice.kind === 'existing') void this.linkExisting(origin, choice.hit, plan.label || choice.hit.label);
      else void this.startCreate(choice.title, origin, plan.label);
    }, plan.query, name => this.typeInfo(name)));
  }
  async linkExisting(origin: Origin, hit: NodeHit, label: string): Promise<void> {
    try {
      const token = this.backend.token();
      const classes = await this.backend.classesFor(hit.entry.file.path);
      if (!this.live || this.backend.token() !== token) return;
      if (!classes.length) { new Notice('That note no longer has a Fileclass; no link was inserted.'); return; }
      insertLink(this.app, origin, hit.entry.file, label);
    } catch (error) { if (this.live) new Notice(`FileClass Inline: ${String(error)}`); }
  }
  async startCreate(seed: string, origin?: Origin, label?: string, body?: string): Promise<void> {
    await this.captures.run({ suggestedTitle: seed, inline: !!origin, sourcePath: origin?.path, body }, async record => {
      if (origin) return insertLink(this.app, origin, record.file, label ?? record.file.basename);
      await this.app.workspace.getLeaf(true).openFile(record.file);
      return true;
    }).catch(error => { if (this.live) new Notice(`FileClass Inline: ${String(error)}`); });
  }
  private async showStatus(): Promise<void> {
    await this.cache.refresh();
    if (!this.live) return;
    const modal = new Modal(this.app);
    modal.contentEl.createEl('h2', { text: 'FileClass Inline · Fileclass' });
    try {
      this.backend.token();
      const binding = this.backend.bindingProperty(this.settings.classProperty);
      modal.contentEl.createEl('p', { text: `Creation writes “${binding}” in ${this.settings.nodesFolder}/ using Fileclass’s configured alias (or the fallback if unavailable). Optional fields never trigger a form.` });
      if (!this.cache.available()) throw new Error('Fileclass is enabled, but its catalog or note index could not be read. Check Fileclass and retry.');
      const classes = this.cache.types();
      modal.contentEl.createEl('p', { text: `${classes.length} class(es), ${this.index.all().length} typed note(s). Icons come from Fileclass. Automatic cleanup is disabled.` });
      if (!classes.length) modal.contentEl.createEl('p', { text: 'Fileclass may still be indexing. Define a class in Fileclass, then try again.' });
    } catch (error) { modal.contentEl.createEl('p', { text: String(error), cls: 'mod-warning' }); }
    this.openModal(modal);
  }
  private openModal(modal: Modal): void {
    const onClose = modal.onClose.bind(modal);
    modal.onClose = () => { this.modals.delete(modal); onClose(); };
    this.modals.add(modal); modal.open();
  }
  private closeModals(): void {
    for (const modal of [...this.modals]) modal.close();
    this.modals.clear();
  }
}
