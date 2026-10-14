import { App, Modal, Notice, parseFrontMatterAliases, parseYaml, TFile } from 'obsidian';
import { NodeIndex, type NodeEntry } from './index';
import { loadSchemas, validateSchema, type NodeSchema } from './schema';
import { CreateNodeModal, TypePicker } from './ui';
import type { FileClassInlineSettings } from './settings';
import type { PruneManager } from './prune';

export interface NodeResult { path: string; title: string; type: string; aliases: string[] }
export interface NodeType { type: string; label: string }
export interface CreateNodeOptions { type?: string; suggestedTitle?: string; sourcePath?: string; signal?: AbortSignal }
export interface FileClassInlineApi {
  readonly version: 1;
  listTypes(): NodeType[];
  searchNodes(query: string): NodeResult[];
  createNode(options: CreateNodeOptions): Promise<NodeResult | null>;
  getNode(path: string): NodeResult | null;
  createNodeForLink?(options: CreateNodeOptions & { sourcePath: string }, link: (node: NodeResult) => Promise<void>): Promise<NodeResult | null>;
}

/** Retained references become inert on disposal. Standalone creation never opts into pruning. */
export class PublicFileClassInlineApi implements FileClassInlineApi {
  readonly version = 1 as const;
  private active = true;
  private pending = new Set<() => void>();
  // Newly written files may not have reached MetadataCache yet.
  private created = new Map<string, { file: TFile; result: NodeResult }>();
  constructor(private app: App, private index: NodeIndex, private settings: () => FileClassInlineSettings, private prune?: Pick<PruneManager, 'track'>) {}
  dispose(): void { this.active = false; for (const cancel of [...this.pending]) cancel(); this.created.clear(); }
  listTypes(): NodeType[] {
    if (!this.active) return [];
    const schemas = this.app.vault.getMarkdownFiles()
      .filter(file => file.path.startsWith(`${this.settings().schemasFolder}/`))
      .flatMap(file => {
        const schema = validateSchema(this.app.metadataCache.getFileCache(file)?.frontmatter, '', file.path).schema;
        return schema ? [schema] : [];
      });
    return schemas.filter(schema => schemas.filter(other => other.nodeType === schema.nodeType).length === 1)
      .map(schema => ({ type: schema.nodeType, label: schema.label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }
  private result(entry: NodeEntry): NodeResult {
    return { path: entry.file.path, title: entry.file.basename, type: entry.type, aliases: entry.labels.slice(1) };
  }
  private refresh(): void {
    this.index.setFolder(this.settings().nodesFolder);
    for (const [path, recent] of this.created) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file !== recent.file || !path.startsWith(`${this.settings().nodesFolder}/`) || this.app.metadataCache.getFileCache(recent.file) != null) this.created.delete(path);
    }
  }
  searchNodes(query: string): NodeResult[] {
    if (!this.active) return [];
    this.refresh();
    const results = this.index.search(query, Infinity).map(hit => this.result(hit.entry));
    for (const { result: node } of this.created.values()) if ([node.title, ...node.aliases].some(label => label.toLowerCase().includes(query.trim().toLowerCase()))) results.push(this.snapshot(node));
    return results;
  }
  private snapshot(node: NodeResult): NodeResult {
    return { ...node, aliases: [...node.aliases] };
  }
  getNode(path: string): NodeResult | null {
    if (!this.active) return null;
    this.refresh();
    const entry = this.index.all().find(node => node.file.path === path);
    const recent = this.created.get(path);
    return entry ? this.result(entry) : recent ? this.snapshot(recent.result) : null;
  }
  async createNodeForLink(options: CreateNodeOptions & { sourcePath: string }, link: (node: NodeResult) => Promise<void>): Promise<NodeResult | null> {
    const source = this.app.vault.getAbstractFileByPath(options.sourcePath);
    if (!(source instanceof TFile)) return null;
    let candidate: { file: TFile; content: string; schema: NodeSchema } | undefined;
    const node = await this.create(options, (file, content, schema, inferable) => {
      if (inferable) candidate = { file, content, schema };
    });
    if (!node) return null;
    if (!this.active || options.signal?.aborted) return node;
    const targetPath = node.path;
    await link(node); // Failed/uncertain linking never establishes cleanup provenance.
    const eligible = () => candidate && this.active && !options.signal?.aborted &&
      this.app.vault.getAbstractFileByPath(options.sourcePath) === source &&
      source.path === options.sourcePath && candidate.file.path === targetPath &&
      this.app.vault.getAbstractFileByPath(targetPath) === candidate.file;
    if (eligible()) {
      // Exact path is a conservative retention token: any remaining mention keeps the node.
      // PruneManager still requires an observed resolved link and all its usual safety fences.
      try {
        const content = await this.app.vault.read(source);
        if (eligible() && content.includes(targetPath)) this.prune?.track(candidate!.file, options.sourcePath, targetPath, candidate!.content, candidate!.schema);
      } catch (error) { console.warn('[FileClass Inline] Link saved; cleanup enrollment skipped, node kept', error); }
    }
    return node;
  }
  createNode(options: CreateNodeOptions): Promise<NodeResult | null> { return this.create(options); }
  private create(options: CreateNodeOptions, created?: (file: TFile, content: string, schema: NodeSchema, inferable: boolean) => void): Promise<NodeResult | null> {
    if (!this.active || options.signal?.aborted) return Promise.resolve(null);
    const { nodesFolder, schemasFolder } = this.settings();
    return new Promise(resolve => {
      let settled = false;
      let dialog: Modal | undefined;
      const finish = (result: NodeResult | null): void => {
        if (settled) return;
        settled = true; this.pending.delete(cancel);
        options.signal?.removeEventListener('abort', cancel);
        resolve(result);
      };
      const cancel = (): void => { finish(null); dialog?.close(); };
      this.pending.add(cancel);
      options.signal?.addEventListener('abort', cancel, { once: true });
      const alive = (): boolean => {
        if (!this.active || settled) return false;
        const current = this.settings();
        if (current.nodesFolder !== nodesFolder || current.schemasFolder !== schemasFolder) { cancel(); return false; }
        return true;
      };
      const show = (schema: NodeSchema): void => {
        if (!alive()) return;
        this.refresh();
        dialog = new CreateNodeModal(this.app, this.index, schema, (file, content, inferable) => {
          if (!alive()) return;
          const meta = parseYaml(content.split('\n---\n')[0].slice(4));
          const result: NodeResult = { path: file.path, title: file.basename, type: schema.nodeType,
            aliases: parseFrontMatterAliases(meta) ?? [] };
          this.created.set(file.path, { file, result });
          created?.(file, content, schema, inferable);
          finish({ ...result, aliases: [...result.aliases] });
        }, options.suggestedTitle ?? '', nodesFolder, schemasFolder, undefined, () => finish(null), alive);
        dialog.open();
      };
      void loadSchemas(this.app, schemasFolder).then(({ schemas }) => {
        if (!alive()) return;
        if (options.type !== undefined) {
          const schema = schemas.find(schema => schema.nodeType === options.type);
          if (schema) show(schema); else { new Notice('FileClass Inline: requested type is unavailable'); finish(null); }
        } else if (schemas.length) {
          let chosen = false;
          dialog = new TypePicker(this.app, schemas, schema => { chosen = true; show(schema); }, () => { if (!chosen) finish(null); });
          dialog.open();
        } else { new Notice('FileClass Inline: no valid node schemas'); finish(null); }
      }).catch(error => { if (alive()) new Notice(`FileClass Inline: ${String(error)}`); finish(null); });
    });
  }
}
