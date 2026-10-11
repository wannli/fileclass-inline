import { App, SuggestModal } from 'obsidian';
import { NodeIndex, type NodeHit } from './index';

export type LinkChoice = { kind: 'existing'; hit: NodeHit } | { kind: 'create'; title: string };
/** Same ranking as inline completion. No automatic link/creation on fuzzy matches. */
export class LinkPicker extends SuggestModal<LinkChoice> {
  constructor(app: App, private index: NodeIndex, private choose: (choice: LinkChoice) => void, private seed = '') {
    super(app);
    this.setPlaceholder('Find an existing node or create one');
  }
  onOpen(): void {
    super.onOpen();
    this.inputEl.value = this.seed;
    this.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
  }
  getSuggestions(query: string): LinkChoice[] {
    const hits: LinkChoice[] = this.index.search(query).map(hit => ({ kind: 'existing', hit }));
    if (query.trim()) hits.push({ kind: 'create', title: query.trim() });
    return hits;
  }
  renderSuggestion(choice: LinkChoice, el: HTMLElement): void {
    if (choice.kind === 'create') { el.createEl('div', { text: `Create “${choice.title}”…` }); return; }
    el.createEl('div', { text: choice.hit.label });
    el.createEl('small', { text: `${choice.hit.entry.type} · ${choice.hit.entry.file.path}` });
  }
  onChooseSuggestion(choice: LinkChoice): void { this.choose(choice); }
}
