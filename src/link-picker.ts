import { App, SuggestModal } from 'obsidian';
import { NodeIndex, type NodeHit } from './index';
import { renderNodeSuggestion } from './suggestion-row';
import { styleSuggestionItem } from './suggestion-style';
import type { ClassInfo } from './fileclass-contract';

export type LinkChoice = { kind: 'existing'; hit: NodeHit } | { kind: 'create'; title: string };
/** Same ranking as inline completion. Never create or reuse a fuzzy match automatically. */
export class LinkPicker extends SuggestModal<LinkChoice> {
  constructor(app: App, private index: NodeIndex, private choose: (choice: LinkChoice) => void,
    private seed = '', private decoration: (type: string) => ClassInfo | undefined = () => undefined) {
    super(app); this.shouldRestoreSelection = false; this.setPlaceholder('Find a typed note or create one');
  }
  onOpen(): void {
    super.onOpen(); this.inputEl.value = this.seed; this.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
  }
  getSuggestions(query: string): LinkChoice[] {
    const hits: LinkChoice[] = this.index.search(query).map(hit => ({ kind: 'existing', hit }));
    if (query.trim()) hits.push({ kind: 'create', title: query.trim() });
    return hits;
  }
  renderSuggestion(choice: LinkChoice, el: HTMLElement): void {
    if (choice.kind === 'create') {
      styleSuggestionItem(el);
      el.createEl('div', { text: `Create “${choice.title}”…` }); return;
    }
    renderNodeSuggestion(choice.hit, el, this.decoration, this.index.isAmbiguous(choice.hit.label));
  }
  onChooseSuggestion(choice: LinkChoice): void { this.choose(choice); }
}
