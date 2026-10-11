import { App, Editor, type EditorPosition, Notice, TFile } from 'obsidian';
import { highlightLink, type HighlightColor } from './highlight';
import { shortestWikiLink } from './links';

/** Reject stale asynchronous insertions rather than guessing where the text moved. */
export interface Origin {
  editor: Editor;
  file: TFile;
  path: string;
  from: EditorPosition;
  to: EditorPosition;
  source: string;
  snapshot: string;
}
export function capture(editor: Editor, file: TFile, from: EditorPosition, to: EditorPosition): Origin {
  const start = { ...from }, end = { ...to };
  return { editor, file, path: file.path, from: start, to: end,
    source: editor.getRange(start, end), snapshot: editor.getValue() };
}
export function isOriginCurrent(app: App, origin: Origin): boolean {
  const active = app.workspace.activeEditor;
  return active?.editor === origin.editor && active.file === origin.file && origin.file.path === origin.path &&
    origin.editor.getValue() === origin.snapshot && origin.editor.getRange(origin.from, origin.to) === origin.source;
}
export function insertLink(app: App, origin: Origin, target: TFile, label: string, highlight?: HighlightColor, onInserted?: (link: string) => void): boolean {
  if (!isOriginCurrent(app, origin)) {
    new Notice(`Node available at ${target.path}; source changed, so no link was inserted.`);
    return false;
  }
  if (/\r|\n|[\[\]|]/.test(label)) {
    new Notice('Cannot use multiline text or link delimiters as a link label');
    return false;
  }
  const link = shortestWikiLink(app, target, origin.path, label);
  const replacement = highlightLink(link, highlight);
  origin.editor.replaceRange(replacement, origin.from, origin.to);
  // Do not leave the original selection (or the new highlight) selected.
  origin.editor.setCursor({ line: origin.from.line, ch: origin.from.ch + replacement.length });
  origin.editor.focus();
  onInserted?.(replacement);
  return true;
}
