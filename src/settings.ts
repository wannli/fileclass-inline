import { App, PluginSettingTab, Setting } from 'obsidian';
import type NodesPlugin from './main';

export interface NodesSettings { nodesFolder: string; schemasFolder: string; trigger: string; cleanupOrphans: boolean }
export const DEFAULT_SETTINGS: NodesSettings = { nodesFolder: 'Nodes', schemasFolder: 'Schemas', trigger: '@', cleanupOrphans: true };

export function validateFolder(value: string): string | null {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.startsWith('/') || value.endsWith('/') || value.includes('\\')) return 'Use a vault-relative folder, without surrounding slashes or spaces';
  if (value.split('/').some(part => !part || part === '.' || part === '..' || part === '.obsidian' || /[\\:*?"<>|\x00-\x1f]/.test(part))) return 'Folder contains an invalid segment';
  return null;
}
export function validateSettings(data: NodesSettings): string | null {
  const invalid = validateFolder(data.nodesFolder) ?? validateFolder(data.schemasFolder);
  if (invalid) return invalid;
  if (data.nodesFolder === data.schemasFolder || data.nodesFolder.startsWith(`${data.schemasFolder}/`) || data.schemasFolder.startsWith(`${data.nodesFolder}/`)) return 'Node and schema folders must not overlap';
  if (typeof data.trigger !== 'string' || [...data.trigger].length !== 1 || /[\p{L}\p{N}\s\[\]\\]/u.test(data.trigger)) return 'Trigger must be one non-letter, non-digit symbol';
  if (typeof data.cleanupOrphans !== 'boolean') return 'Unused-node cleanup must be on or off';
  return null;
}

export class NodesSettingsTab extends PluginSettingTab {
  constructor(app: App, private plugin: NodesPlugin) { super(app, plugin); }
  display(): void {
    const { containerEl } = this; containerEl.empty();
    containerEl.createEl('h2', { text: 'Nodes' });
    const draft = { ...this.plugin.settings };
    new Setting(containerEl).setName('Node folder').setDesc('Vault-relative folder, default Nodes')
      .addText(text => text.setValue(draft.nodesFolder).onChange(value => { draft.nodesFolder = value; }));
    new Setting(containerEl).setName('Schema folder').setDesc('Vault-relative folder, default Schemas')
      .addText(text => text.setValue(draft.schemasFolder).onChange(value => { draft.schemasFolder = value; }));
    new Setting(containerEl).setName('Inline trigger').setDesc('Default @')
      .addText(text => text.setValue(draft.trigger).onChange(value => { draft.trigger = value; }));
    new Setting(containerEl).setName('Clean up unused nodes')
      .setDesc('Move only pristine, plugin-created, unreferenced nodes to Obsidian’s local trash. Never permanently delete.')
      .addToggle(toggle => toggle.setValue(draft.cleanupOrphans).onChange(value => { draft.cleanupOrphans = value; }));
    const message = containerEl.createEl('p', { attr: { role: 'alert' } });
    new Setting(containerEl).addButton(button => button.setButtonText('Save').setCta().onClick(async () => {
      const error = validateSettings(draft);
      if (error) { message.setText(error); return; }
      await this.plugin.saveSettings(draft);
      message.setText('Settings saved. Existing files were not moved.');
    }));
  }
}
