import type { App, TFile } from 'obsidian';

/** Find the shortest path Obsidian actually resolves to this file; fresh files may not be cached yet. */
export function shortestWikiLink(app: App, file: TFile, sourcePath: string, alias?: string): string {
  const parts = file.path.slice(0, -3).split('/');
  let linkpath = app.metadataCache.fileToLinktext(file, sourcePath, true);
  for (let start = parts.length - 1; start >= 0; start--) {
    const candidate = parts.slice(start).join('/');
    if (app.metadataCache.getFirstLinkpathDest(candidate, sourcePath)?.path === file.path) {
      linkpath = candidate;
      break;
    }
  }
  return `[[${linkpath}${alias && alias !== file.basename ? `|${alias}` : ''}]]`;
}
