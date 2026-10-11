import { App, Editor, type EditorPosition, Notice, TFile } from 'obsidian';

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
export function insertLink(app: App, origin: Origin, target: TFile, label: string): boolean {
  const active = app.workspace.activeEditor;
  if (active?.editor !== origin.editor || active.file !== origin.file || origin.file.path !== origin.path ||
    origin.editor.getValue() !== origin.snapshot || origin.editor.getRange(origin.from, origin.to) !== origin.source) {
    new Notice(`Node available at ${target.path}; source changed, so no link was inserted.`);
    return false;
  }
  if (/\r|\n|[\[\]|]/.test(label)) {
    new Notice('Cannot use multiline text or link delimiters as a link label');
    return false;
  }
  const link = app.fileManager.generateMarkdownLink(target, origin.path, undefined, label);
  origin.editor.replaceRange(link, origin.from, origin.to);
  return true;
}
