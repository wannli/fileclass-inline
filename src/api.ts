import { App, TFile } from 'obsidian';
import type { ClassInfo } from './fileclass-contract';
import type { CaptureController, CreatedCapture } from './capture';
import type { NodeEntry, NodeIndex } from './index';

export interface NodeResult { path: string; title: string; type: string; classes: string[]; aliases: string[]; icon?: string }
export interface NodeType { type: string; label: string; icon?: string }
export interface CreateNodeOptions { type?: string; suggestedTitle?: string; sourcePath?: string; signal?: AbortSignal }
export interface NodesApi {
  readonly version: 2;
  listTypes(): NodeType[];
  searchNodes(query: string): NodeResult[];
  createNode(options: CreateNodeOptions): Promise<NodeResult | null>;
  getNode(path: string): NodeResult | null;
  createNodeForLink?(options: CreateNodeOptions & { sourcePath: string }, link: (node: NodeResult) => Promise<void>): Promise<NodeResult | null>;
}

/** Version 2: Fileclass membership and post-creation completion; cleanup is never enrolled. */
export class PublicNodesApi implements NodesApi {
  readonly version = 2 as const;
  private active = true;
  constructor(private app: App, private index: NodeIndex, private types: () => ClassInfo[],
    private capture: CaptureController, private connected: () => boolean) {}
  dispose(): void { this.active = false; this.capture.dispose(); }
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
  async createNode(options: CreateNodeOptions): Promise<NodeResult | null> {
    if (!this.alive()) return null;
    const record = await this.capture.run(options);
    return record && this.alive() && !options.signal?.aborted && this.app.vault.getAbstractFileByPath(record.file.path) === record.file ? this.created(record) : null;
  }
  async createNodeForLink(options: CreateNodeOptions & { sourcePath: string }, link: (node: NodeResult) => Promise<void>): Promise<NodeResult | null> {
    if (!this.alive() || options.signal?.aborted) return null;
    const source = this.app.vault.getAbstractFileByPath(options.sourcePath);
    if (!(source instanceof TFile)) return null;
    const record = await this.capture.run(options, async created => {
      if (!this.alive() || options.signal?.aborted || source.path !== options.sourcePath || this.app.vault.getAbstractFileByPath(options.sourcePath) !== source) return false;
      // The caller owns its editor/content guard. Pass an independent snapshot.
      await link(this.created(created));
      return true;
    });
    return record && this.alive() && !options.signal?.aborted && this.app.vault.getAbstractFileByPath(record.file.path) === record.file ? this.created(record) : null;
  }
}
