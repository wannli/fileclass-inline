import { App, Editor, type EditorPosition, Notice, TFile } from 'obsidian';
import { shortestWikiLink } from './links';

/** Reject stale asynchronous insertions rather than guessing where the text moved. */
export interface Origin {
  editor: Editor; file: TFile; path: string;
  from: EditorPosition; to: EditorPosition; source: string; snapshot: string;
}
export function capture(editor: Editor, file: TFile, from: EditorPosition, to: EditorPosition): Origin {
  const start = { ...from }, end = { ...to };
  return { editor, file, path: file.path, from: start, to: end,
    source: editor.getRange(start, end), snapshot: editor.getValue() };
}
export function isOriginCurrent(app: App, origin: Origin): boolean {
  const active = app.workspace.activeEditor;
  return active?.editor === origin.editor && active.file === origin.file && origin.file.path === origin.path &&
    app.vault.getAbstractFileByPath(origin.path) === origin.file &&
    origin.editor.getValue() === origin.snapshot && origin.editor.getRange(origin.from, origin.to) === origin.source;
}
export function insertLink(app: App, origin: Origin, target: TFile, label: string): boolean {
  if (!isOriginCurrent(app, origin) || app.vault.getAbstractFileByPath(target.path) !== target) {
    new Notice(`Node available at ${target.path}; source or target changed, so no link was inserted.`);
    return false;
  }
  if (/\r|\n|[\[\]|]/.test(label)) {
    new Notice('Cannot use multiline text or link delimiters as a link label'); return false;
  }
  const link = shortestWikiLink(app, target, origin.path, label);
  origin.editor.replaceRange(link, origin.from, origin.to);
  origin.editor.setCursor({ line: origin.from.line, ch: origin.from.ch + link.length });
  origin.editor.focus();
  return true;
}
