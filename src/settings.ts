import { AbstractInputSuggest, App, PluginSettingTab, Setting, TFolder } from 'obsidian';
import type NodesPlugin from './main';

export interface NodesSettings { nodesFolder: string; classProperty: string; trigger: string }
export const DEFAULT_SETTINGS: NodesSettings = {
  nodesFolder: 'Nodes', classProperty: 'fileClass', trigger: '@',
};

export function validateFolder(value: string): string | null {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.startsWith('/') || value.endsWith('/') || value.includes('\\')) return 'Use a vault-relative folder without surrounding slashes or spaces';
  if (value.split('/').some(part => !part || part === '.' || part === '..' || part === '.obsidian' || /[\\:*?"<>|\x00-\x1f]/.test(part))) return 'Folder contains an invalid segment';
  return null;
}
export function validateSettings(data: NodesSettings): string | null {
  const invalid = validateFolder(data.nodesFolder);
  if (invalid) return invalid;
  if (typeof data.classProperty !== 'string' || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(data.classProperty) || ['__proto__', 'prototype', 'constructor'].includes(data.classProperty)) return 'Use a simple property name matching Fileclass’s fileClass alias';
  if (typeof data.trigger !== 'string' || [...data.trigger].length !== 1 || /[\p{L}\p{N}\s\[\]\\]/u.test(data.trigger)) return 'Trigger must be one non-letter, non-digit symbol';
  return null;
}
export class FolderSuggest extends AbstractInputSuggest<TFolder> {
  constructor(app: App, inputEl: HTMLInputElement) { super(app, inputEl); }
  getSuggestions(query: string): TFolder[] {
    const needle = query.trim().toLowerCase();
    return this.app.vault.getAllLoadedFiles()
      .filter((file): file is TFolder => file instanceof TFolder && !!file.path && !file.path.startsWith('.obsidian/'))
      .filter(folder => !needle || folder.path.toLowerCase().includes(needle))
      .sort((a, b) => a.path.localeCompare(b.path));
  }
  renderSuggestion(folder: TFolder, el: HTMLElement): void { el.setText(folder.path); }
  selectSuggestion(folder: TFolder): void { this.setValue(folder.path); this.close(); }
}

/** Ignore legacy cleanup records/settings: Fileclass-created notes are never pruned. */
export function loadSettings(stored: unknown): NodesSettings {
  const data = stored && typeof stored === 'object' ? stored as Partial<NodesSettings> : {};
  const result = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(result) as (keyof NodesSettings)[]) if (typeof data[key] === 'string') result[key] = data[key]!;
  return validateSettings(result) ? { ...DEFAULT_SETTINGS } : result;
}

export class NodesSettingsTab extends PluginSettingTab {
  constructor(app: App, private plugin: NodesPlugin) { super(app, plugin); }
  display(): void {
    const { containerEl } = this;
    containerEl.empty(); containerEl.createEl('h2', { text: 'Nodes · Fileclass companion' });
    containerEl.createEl('p', { text: 'Fileclass must be installed and enabled. Nodes uses its public API; optional fields never open a completion form.' });
    const draft = { ...this.plugin.settings };
    new Setting(containerEl).setName('Capture folder').setDesc('New notes only. Choose an existing vault folder; finding existing Fileclass notes works throughout the vault.')
      .addText(text => {
        text.setPlaceholder('Choose a folder').setValue(draft.nodesFolder)
          .onChange(value => { draft.nodesFolder = value; });
        new FolderSuggest(this.app, text.inputEl);
      });
    new Setting(containerEl).setName('Class binding property').setDesc('Must match Fileclass’s “fileClass alias” setting. Default: fileClass.')
      .addText(text => text.setValue(draft.classProperty).onChange(value => { draft.classProperty = value; }));
    new Setting(containerEl).setName('Inline trigger').setDesc('Default: @')
      .addText(text => text.setValue(draft.trigger).onChange(value => { draft.trigger = value; }));
    containerEl.createEl('p', { text: 'No automatic cleanup, template execution, schema conversion, or changes to existing notes. Required-field edits save to an already-created note.' });
    const message = containerEl.createEl('p', { attr: { role: 'alert' } });
    new Setting(containerEl).addButton(button => button.setButtonText('Save').setCta().onClick(async () => {
      const error = validateSettings(draft);
      if (error) { message.setText(error); return; }
      await this.plugin.saveSettings(draft); message.setText('Settings saved. Existing files were not moved or rewritten.');
    }));
  }
}
