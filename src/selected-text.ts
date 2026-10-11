export interface SelectionPlan { query: string; body?: string; label?: string }

/** Multi-line selections become a new node body; never discard them to link an existing note. */
export function planSelection(source: string): SelectionPlan {
  const query = source.split(/\r?\n/).find(line => line.trim())?.trim() ?? '';
  if (/[\r\n]/.test(source)) return { query, body: source };
  return { query: source.trim(), label: source };
}
