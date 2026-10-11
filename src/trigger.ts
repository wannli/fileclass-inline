import type { Editor, EditorPosition, EditorSuggestTriggerInfo } from 'obsidian';

/** Conservative Markdown guard. It only does the more expensive document check after @ is detected. */
export function atTrigger(editor: Editor, cursor: EditorPosition): EditorSuggestTriggerInfo | null {
  if (editor.somethingSelected()) return null;
  const before = editor.getLine(cursor.line).slice(0, cursor.ch);
  const match = before.match(/(^|[\s([{])@([\p{L}\p{N}_ .'-]{0,80})$/u);
  if (!match) return null;
  const start = { line: cursor.line, ch: cursor.ch - match[2].length - 1 };
  const linePrefix = before.slice(0, start.ch);
  if (linePrefix.lastIndexOf('[[') > linePrefix.lastIndexOf(']]') ||
      linePrefix.lastIndexOf('](') > linePrefix.lastIndexOf(')')) return null;
  const documentPrefix = editor.getValue().split('\n').slice(0, cursor.line + 1);
  if (documentPrefix[0] === '---' && cursor.line > 0 && !documentPrefix.slice(1).includes('---')) return null;
  let fence: string | null = null;
  for (const line of documentPrefix.slice(0, -1)) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (marker) { if (!fence) fence = marker[1][0]; else if (fence === marker[1][0]) fence = null; }
  }
  if (fence) return null;
  if ((linePrefix.match(/(?<!\\)`/g) ?? []).length % 2) return null;
  return { start, end: { ...cursor }, query: match[2] };
}
