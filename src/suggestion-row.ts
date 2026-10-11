import type { NodeHit } from './index';

/** One line, Tana-style: node name followed by its muted type. */
export function renderNodeSuggestion(hit: NodeHit, el: HTMLElement): void {
  el.setAttribute('title', hit.entry.file.path);
  el.setAttribute('aria-label', `${hit.label}, type ${hit.entry.type}, ${hit.entry.file.path}`);
  el.createSpan({ text: hit.label });
  const type = el.createSpan({ text: `#${hit.entry.type}` });
  type.style.marginInlineStart = '0.4em';
  type.style.color = 'var(--text-muted)';
  type.style.fontSize = 'var(--font-smaller)';
}
