import { renderClassIcon, styleSuggestionItem } from './suggestion-style';
import type { NodeHit } from './index';
import type { ClassInfo } from './fileclass-contract';

/** One line: node name followed by Fileclass icons and muted native badges. */
export function renderNodeSuggestion(hit: NodeHit, el: HTMLElement, decorationForClass?: (name: string) => ClassInfo | undefined, showPath = false): void {
  const classes = hit.entry.classes ?? [hit.entry.type];
  el.setAttribute('title', hit.entry.file.path);
  el.setAttribute('aria-label', `${hit.label}, classes ${classes.join(', ')}, ${hit.entry.file.path}`);
  styleSuggestionItem(el, showPath);
  const row = showPath ? el.createSpan() : el;
  row.style.display = 'flex';
  row.style.alignItems = 'center';
  row.style.flexWrap = 'nowrap';
  row.style.whiteSpace = 'nowrap';
  row.style.overflow = 'hidden';
  const label = row.createSpan({ text: hit.label });
  label.style.minWidth = '0';
  label.style.overflow = 'hidden';
  label.style.textOverflow = 'ellipsis';
  for (const name of classes) {
    const decoration = decorationForClass?.(name);
    const badge = row.createSpan();
    badge.style.display = 'inline-flex';
    badge.style.alignItems = 'center';
    badge.style.flexShrink = '0';
    badge.style.gap = 'var(--size-4-1, 4px)';
    badge.style.marginInlineStart = 'var(--size-4-2, 8px)';
    badge.style.fontSize = 'var(--font-smaller)';
    if (decoration?.icon) renderClassIcon(badge, decoration.icon);
    badge.createSpan({ text: `#${name}` });
    badge.style.color = 'var(--text-muted)';
  }
  if (showPath) {
    // Shared aliases can belong to different files in the same folder: show the filename too.
    const path = el.createSpan({ text: hit.entry.file.path });
    path.style.display = 'block'; path.style.fontSize = 'var(--font-smaller)';
    path.style.color = 'var(--text-muted)'; path.style.whiteSpace = 'normal'; path.style.overflowWrap = 'anywhere';
  }
}
