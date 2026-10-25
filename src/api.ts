import { App, TFile } from 'obsidian';
import type { ClassInfo, FileclassBackend } from './fileclass-contract';
import type { CaptureController, CreatedCapture } from './capture';
import type { NodeEntry, NodeIndex } from './index';
import { LinkPicker, type LinkChoice } from './link-picker';

export interface NodeResult { path: string; title: string; type: string; classes: string[]; aliases: string[]; icon?: string }
export interface NodeType { type: string; label: string; icon?: string }
export interface CreateNodeOptions { type?: string; suggestedTitle?: string; sourcePath?: string; signal?: AbortSignal; completionContainer?: HTMLElement }
export interface PickNodeForLinkOptions { suggestedTitle?: string; sourcePath: string; signal?: AbortSignal }
export interface NodesApi {
  readonly version: 2;
  readonly embeddedCreation?: true;
  listTypes(): NodeType[];
  searchNodes(query: string): NodeResult[];
  createNode(options: CreateNodeOptions): Promise<NodeResult | null>;
  getNode(path: string): NodeResult | null;
  pickNodeForLink?(options: PickNodeForLinkOptions, link: (node: NodeResult) => Promise<void>): Promise<NodeResult | null>;
  createNodeForLink?(options: CreateNodeOptions & { sourcePath: string }, link: (node: NodeResult) => Promise<void>): Promise<NodeResult | null>;
}

/** Version 2: Fileclass membership and post-creation completion; cleanup is never enrolled. */
export class PublicNodesApi implements NodesApi {
  readonly version = 2 as const;
  readonly embeddedCreation = true as const;
  private active = true;
  private requests = new Set<AbortController>();
  constructor(private app: App, private index: NodeIndex, private types: () => ClassInfo[],
    private capture: CaptureController, private connected: () => boolean, private backend: FileclassBackend) {}
  cancelAll(): void { for (const controller of [...this.requests]) controller.abort(); }
  dispose(): void { this.active = false; this.cancelAll(); this.capture.dispose(); }
  private alive(): boolean { return this.active && this.connected(); }
  listTypes(): NodeType[] {
    return this.alive() ? this.types().map(item => ({ type: item.name, label: item.name, ...(item.icon ? { icon: item.icon } : {}) })) : [];
  }
  private result(entry: NodeEntry): NodeResult {
    const icon = this.types().find(item => item.name === entry.type)?.icon;
    return { path: entry.file.path, title: entry.file.basename, type: entry.type, classes: [...entry.classes],
      aliases: entry.labels.slice(1), ...(icon ? { icon } : {}) };
  }
  private created(record: CreatedCapture): NodeResult {
    return { path: record.file.path, title: record.file.basename, type: record.type.name,
      classes: [...record.classes], aliases: [...record.aliases], ...(record.type.icon ? { icon: record.type.icon } : {}) };
  }
  searchNodes(query: string): NodeResult[] {
    return this.alive() ? this.index.search(query, Infinity).map(hit => this.result(hit.entry)) : [];
  }
  getNode(path: string): NodeResult | null {
    if (!this.alive()) return null;
    const entry = this.index.all().find(item => item.file.path === path);
    return entry ? this.result(entry) : null;
  }
  pickNodeForLink(options: PickNodeForLinkOptions, link: (node: NodeResult) => Promise<void>): Promise<NodeResult | null> {
    if (!this.alive() || options.signal?.aborted) return Promise.resolve(null);
    const sourcePath = options.sourcePath;
    const source = this.app.vault.getAbstractFileByPath(sourcePath);
    if (!(source instanceof TFile)) return Promise.resolve(null);
    let token: object;
    try { token = this.backend.token(); } catch { return Promise.resolve(null); }
    const controller = new AbortController(); this.requests.add(controller);
    const signal = controller.signal;
    const forward = (): void => controller.abort();
    options.signal?.addEventListener('abort', forward, { once: true });
    const current = (): boolean => {
      try { return this.alive() && !signal.aborted && this.backend.token() === token && source.path === sourcePath &&
        this.app.vault.getAbstractFileByPath(sourcePath) === source; } catch { return false; }
    };
    return new Promise<NodeResult | null>((resolve, reject) => {
      let settled = false, chosen = false;
      const finish = (value: NodeResult | null, failed = false, error?: unknown): void => {
        if (settled) return;
        settled = true; this.requests.delete(controller);
        options.signal?.removeEventListener('abort', forward);
        signal.removeEventListener('abort', cancel);
        picker.close();
        if (failed) reject(error); else resolve(value);
      };
      const select = async (choice: LinkChoice): Promise<NodeResult | null> => {
        if (!current()) return null;
        if (choice.kind === 'create') {
          const record = await this.capture.run({ suggestedTitle: choice.title, sourcePath, signal, inline: true }, async created => {
            if (!current()) return false;
            await link(this.created(created));
            return true;
          });
          return record && this.alive() && !signal.aborted && this.app.vault.getAbstractFileByPath(record.file.path) === record.file ? this.created(record) : null;
        }
        const entry = choice.hit.entry, path = entry.file.path;
        let classes: string[];
        try { classes = await this.backend.classesFor(path); } catch { return null; }
        if (!current() || !classes.length || entry.file.path !== path ||
          this.app.vault.getAbstractFileByPath(path) !== entry.file) return null;
        // Reconcile before invoking consumers that guard against getNode(). A cache
        // rebuild may replace NodeEntry objects without replacing the actual file.
        this.index.remember(entry.file, classes);
        const snapshot = this.index.all().find(item => item.file === entry.file);
        if (!snapshot) return null;
        await link(this.result(snapshot));
        return this.alive() && !signal.aborted && entry.file.path === path && this.app.vault.getAbstractFileByPath(path) === entry.file ? this.result(snapshot) : null;
      };
      const picker = new LinkPicker(this.app, this.index, choice => {
        if (chosen || settled) return;
        chosen = true; picker.close();
        void select(choice).then(value => finish(value), error => finish(null, true, error));
      }, options.suggestedTitle ?? '', name => this.types().find(type => type.name === name));
      // SuggestModal may close before delivering its synchronous selection callback.
      const onClose = picker.onClose.bind(picker);
      picker.onClose = () => {
        onClose(); queueMicrotask(() => { if (!chosen) finish(null); });
      };
      const cancel = (): void => finish(null);
      signal.addEventListener('abort', cancel, { once: true });
      try { picker.open(); } catch (error) { finish(null, true, error); }
    });
  }
  async createNode(options: CreateNodeOptions): Promise<NodeResult | null> {
    if (!this.alive()) return null;
    const record = await this.capture.run(options);
    return record && this.alive() && !options.signal?.aborted && this.app.vault.getAbstractFileByPath(record.file.path) === record.file ? this.created(record) : null;
  }
  async createNodeForLink(options: CreateNodeOptions & { sourcePath: string }, link: (node: NodeResult) => Promise<void>): Promise<NodeResult | null> {
    if (!this.alive() || options.signal?.aborted) return null;
    const source = this.app.vault.getAbstractFileByPath(options.sourcePath);
    if (!(source instanceof TFile)) return null;
    const record = await this.capture.run({ ...options, inline: !!options.completionContainer }, async created => {
      if (!this.alive() || options.signal?.aborted || source.path !== options.sourcePath || this.app.vault.getAbstractFileByPath(options.sourcePath) !== source) return false;
      // The caller owns its editor/content guard. Pass an independent snapshot.
      await link(this.created(created));
      return true;
    });
    return record && this.alive() && !options.signal?.aborted && this.app.vault.getAbstractFileByPath(record.file.path) === record.file ? this.created(record) : null;
  }
}
