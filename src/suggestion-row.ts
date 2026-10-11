import type { NodeHit } from './index';
import type { HighlightColor } from './highlight';

/** One line, Tana-style: node name followed by a subtle native-color type tag. */
export function renderNodeSuggestion(hit: NodeHit, el: HTMLElement, color?: HighlightColor): void {
  el.setAttribute('title', hit.entry.file.path);
  el.setAttribute('aria-label', `${hit.label}, type ${hit.entry.type}, ${hit.entry.file.path}`);
  el.createSpan({ text: hit.label });
  const type = el.createSpan({ text: `#${hit.entry.type}` });
  type.style.marginInlineStart = '0.4em';
  type.style.fontSize = 'var(--font-smaller)';
  if (color) {
    type.style.color = 'var(--text-normal)';
    type.style.backgroundColor = `color-mix(in srgb, var(--color-${color}) 25%, transparent)`;
    type.style.borderRadius = 'var(--radius-s)';
    type.style.padding = '0 0.35em';
  } else type.style.color = 'var(--text-muted)';
}
