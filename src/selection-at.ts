import { EditorView } from '@codemirror/view';
import { App, MarkdownView } from 'obsidian';
import { capture, isOriginCurrent, type Origin } from './references';

/** CodeMirror input handlers receive the original selection before text replacement. */
export function isSelectedTriggerInput(view: EditorView, from: number, to: number, text: string, trigger: string): boolean {
  const selection = view.state.selection;
  return text === trigger && !view.composing && selection.ranges.length === 1 &&
    from < to && selection.main.from === from && selection.main.to === to &&
    !!view.state.doc.sliceString(from, to).trim();
}

/** Return true only after safely capturing the selected text; never insert @ in its place. */
export function selectedAtExtension(app: App, trigger: () => string, open: (origin: Origin) => void) {
  return EditorView.inputHandler.of((view, from, to, text) => {
    if (!isSelectedTriggerInput(view, from, to, text, trigger())) return false;
    const markdown = app.workspace.getActiveViewOfType(MarkdownView);
    if (!markdown?.file || !markdown.contentEl.contains(view.dom)) return false;
    const editor = markdown.editor;
    const selected = view.state.doc.sliceString(from, to);
    if (editor.getSelection() !== selected) return false;
    const origin = capture(editor, markdown.file, editor.getCursor('from'), editor.getCursor('to'));
    if (origin.source !== selected) return false;
    queueMicrotask(() => { if (isOriginCurrent(app, origin)) open(origin); });
    return true;
  });
}
