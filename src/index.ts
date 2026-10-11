import { App, parseFrontMatterAliases, prepareFuzzySearch, TFile } from 'obsidian';

export interface NodeEntry { file: TFile; type: string; labels: string[] }
export interface NodeHit { entry: NodeEntry; label: string; rank: number; score: number }

/** Rebuilds on host metadata/file events, not on every keystroke. */
export class NodeIndex {
  private entries: NodeEntry[] = [];
  constructor(private app: App, private folder = 'Nodes') { this.rebuild(); }
  setFolder(folder: string): void { this.folder = folder; this.rebuild(); }
  rebuild(): void {
    this.entries = this.app.vault.getMarkdownFiles().filter(file => file.path.startsWith(`${this.folder}/`)).flatMap(file => {
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (typeof frontmatter?.type !== 'string' || !frontmatter.type.trim()) return [];
      const aliases = parseFrontMatterAliases(frontmatter) ?? [];
      return [{ file, type: frontmatter.type, labels: [file.basename, ...aliases.filter(label => typeof label === 'string' && !!label.trim())] }];
    });
  }
  all(): readonly NodeEntry[] { return this.entries; }
  search(query: string, limit = 20, type?: string): NodeHit[] {
    const term = query.trim().toLocaleLowerCase();
    const fuzzy = term ? prepareFuzzySearch(query.trim()) : null;
    const hits: NodeHit[] = [];
    for (const entry of this.entries) {
      if (type && entry.type !== type) continue;
      let best: NodeHit | undefined;
      for (const label of entry.labels) {
        const lower = label.toLocaleLowerCase();
        const match = fuzzy?.(label);
        if (term && !match) continue;
        const rank = !term ? 3 : lower === term ? 0 : lower.startsWith(term) ? 1 : 2;
        const candidate: NodeHit = { entry, label, rank, score: match?.score ?? 0 };
        if (!best || compare(candidate, best) < 0) best = candidate;
      }
      if (best) hits.push(best);
    }
    return hits.sort(compare).slice(0, limit);
  }
}

function compare(a: NodeHit, b: NodeHit): number {
  return a.rank - b.rank || a.score - b.score || a.label.localeCompare(b.label) || a.entry.file.path.localeCompare(b.entry.file.path);
}
