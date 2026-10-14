import { App, MarkdownView, TFile } from 'obsidian';
import type { NodeSchema } from './schema';
import { loadSchemas } from './schema';

/** A record exists only for a pristine node created while inserting a link. */
export interface TrackedNode {
  path: string;
  createdAt: number;
  sourcePath: string;
  sourceLink: string;
  content: string;
  schemaPath: string;
  schemaSnapshot: string;
}

function record(value: unknown): value is TrackedNode {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return ['path', 'sourcePath', 'sourceLink', 'content', 'schemaPath', 'schemaSnapshot']
    .every(key => typeof item[key] === 'string') && typeof item.createdAt === 'number' &&
    Number.isFinite(item.createdAt) && !!item.sourceLink &&
    (item.content as string).length <= 16_000 && (item.schemaSnapshot as string).length <= 16_000;
}

export function hasLinks(app: App, path: string): boolean {
  return Object.values(app.metadataCache.resolvedLinks).some(destinations => (destinations?.[path] ?? 0) > 0) ||
    Object.values(app.metadataCache.resolvedLinks[path] ?? {}).some(count => count > 0) ||
    Object.keys(app.metadataCache.unresolvedLinks[path] ?? {}).length > 0;
}

export class PruneManager {
  private tracked: Record<string, TrackedNode> = Object.create(null);
  private observed = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private checking = false;
  private disposed = false;
  constructor(private app: App, private folders: () => { nodesFolder: string; schemasFolder: string; cleanupOrphans: boolean }, private save: () => Promise<void>) {}

  restore(data: unknown): void {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return;
    for (const [path, value] of Object.entries(data)) if (record(value) && path === value.path) this.tracked[path] = value;
  }
  entries(): Record<string, TrackedNode> { return { ...this.tracked }; }
  track(file: TFile, sourcePath: string, sourceLink: string, content: string, schema: NodeSchema): void {
    const schemaSnapshot = JSON.stringify(schema);
    if (content.length > 16_000 || schemaSnapshot.length > 16_000 || sourceLink.length > 1_000) return;
    if (this.disposed) return;
    this.tracked[file.path] = { path: file.path, createdAt: file.stat.ctime, sourcePath, sourceLink, content, schemaPath: schema.path, schemaSnapshot };
    void this.save().catch(error => console.warn('[FileClass Inline] Could not save cleanup tracking', error));
    this.onResolved();
  }
  forget(path: string): void {
    if (!this.tracked[path]) return;
    delete this.tracked[path]; this.observed.delete(path);
    void this.save().catch(error => console.warn('[FileClass Inline] Could not save cleanup tracking', error));
  }
  forgetBySource(path: string): void {
    for (const item of Object.values(this.tracked)) if (item.sourcePath === path) this.forget(item.path);
  }
  /** A metadata 'resolved' event follows the vault's link-index refresh. */
  onResolved(): void {
    if (this.disposed || !this.folders().cleanupOrphans) return;
    for (const item of Object.values(this.tracked)) {
      if ((this.app.metadataCache.resolvedLinks[item.sourcePath]?.[item.path] ?? 0) > 0) this.observed.add(item.path);
    }
    if ([...this.observed].some(path => this.tracked[path] && !hasLinks(this.app, path))) this.schedule();
  }
  dispose(): void { this.disposed = true; if (this.timer) clearTimeout(this.timer); this.timer = null; }
  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.sweep(); }, 3000);
  }
  private async sweep(): Promise<void> {
    if (this.checking || this.disposed || !this.folders().cleanupOrphans) return;
    this.checking = true;
    try {
      const { nodesFolder, schemasFolder } = this.folders();
      const catalog = await loadSchemas(this.app, schemasFolder);
      for (const item of Object.values(this.tracked)) {
        if (!this.observed.has(item.path) || !item.path.startsWith(`${nodesFolder}/`) || hasLinks(this.app, item.path)) continue;
        const node = this.app.vault.getAbstractFileByPath(item.path);
        const source = this.app.vault.getAbstractFileByPath(item.sourcePath);
        if (!(node instanceof TFile) || !(source instanceof TFile) || node.stat.ctime !== item.createdAt) continue;
        if (!catalog.schemas.some(schema => schema.path === item.schemaPath && JSON.stringify(schema) === item.schemaSnapshot)) continue;
        const cache = this.app.metadataCache.getFileCache(node);
        if (cache?.links?.length || cache?.embeds?.length || cache?.frontmatterLinks?.length) continue;
        const openViews: MarkdownView[] = [];
        this.app.workspace.iterateAllLeaves(leaf => { if (leaf.view instanceof MarkdownView) openViews.push(leaf.view); });
        if (openViews.some(view => view.file?.path === item.path)) continue;
        try {
          // An unsaved open note might already contain a new link that the link cache has not seen.
          let unsaved = false;
          for (const view of openViews) if (view.file?.extension === 'md' &&
            view.editor.getValue() !== await this.app.vault.read(view.file)) { unsaved = true; break; }
          if (unsaved) continue;
          const [current, sourceContent] = await Promise.all([this.app.vault.read(node), this.app.vault.read(source)]);
          if (current !== item.content || sourceContent.includes(item.sourceLink) || hasLinks(this.app, item.path)) continue;
          // Check again just before trashing; edits or new links fail closed.
          if (this.disposed || !this.folders().cleanupOrphans || this.app.vault.getAbstractFileByPath(item.path) !== node ||
              await this.app.vault.read(node) !== item.content || hasLinks(this.app, item.path)) continue;
          await this.app.vault.trash(node, false);
          this.forget(item.path);
        } catch (error) { console.warn(`[FileClass Inline] Could not check unused node ${item.path}`, error); }
      }
    } finally { this.checking = false; }
  }
}
