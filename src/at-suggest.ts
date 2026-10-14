import { Editor, EditorSuggest, type EditorSuggestContext, type EditorSuggestTriggerInfo, type EditorPosition, TFile } from 'obsidian';
import type NodesPlugin from './main';
import type { NodeHit } from './index';
import { atTrigger } from './trigger';
import { capture } from './references';
import { renderNodeSuggestion } from './suggestion-row';
import { styleSuggestionItem } from './suggestion-style';

type InlineChoice = { kind: 'existing'; hit: NodeHit } | { kind: 'create'; title: string };
export class AtSuggest extends EditorSuggest<InlineChoice> {
  constructor(app: NodesPlugin['app'], private plugin: NodesPlugin) { super(app); this.limit = 21; }
  onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
    return file && this.plugin.available() ? atTrigger(editor, cursor, this.plugin.settings.trigger) : null;
  }
  getSuggestions(context: EditorSuggestContext): InlineChoice[] {
    if (!this.plugin.available()) return [];
    const items: InlineChoice[] = this.plugin.index.search(context.query, 20).map(hit => ({ kind: 'existing', hit }));
    if (context.query.trim()) items.push({ kind: 'create', title: context.query.trim() });
    return items;
  }
  renderSuggestion(choice: InlineChoice, el: HTMLElement): void {
    if (choice.kind === 'create') {
      styleSuggestionItem(el);
      el.createEl('div', { text: `Create “${choice.title}”…` }); return;
    }
    renderNodeSuggestion(choice.hit, el, name => this.plugin.typeInfo(name), this.plugin.index.isAmbiguous(choice.hit.label));
  }
  selectSuggestion(choice: InlineChoice): void {
    const context = this.context; this.close();
    if (!context?.file || !this.plugin.available()) return;
    const origin = capture(context.editor, context.file, context.start, context.end);
    if (choice.kind === 'existing') void this.plugin.linkExisting(origin, choice.hit, choice.hit.label);
    else void this.plugin.startCreate(choice.title, origin);
  }
}
