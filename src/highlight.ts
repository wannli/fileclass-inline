// Obsidian's six built-in colored highlight markers, e.g. ==🟢text==.
export const HIGHLIGHT_EMOJI = {
  red: '🔴',
  orange: '🟠',
  yellow: '🟡',
  green: '🟢',
  blue: '🔵',
  purple: '🟣',
} as const;

export type HighlightColor = keyof typeof HIGHLIGHT_EMOJI;

export function isHighlightColor(value: unknown): value is HighlightColor {
  return typeof value === 'string' && Object.hasOwn(HIGHLIGHT_EMOJI, value);
}

export function highlightLink(link: string, color?: HighlightColor): string {
  return color ? `==${HIGHLIGHT_EMOJI[color]}${link}==` : link;
}
