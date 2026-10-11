import { Notice, Plugin } from 'obsidian';

export default class NodesPlugin extends Plugin {
  override onload(): void {
    this.addCommand({
      id: 'say-hello',
      name: 'Say hello (hot reload test)',
      callback: () => new Notice('Hot reload works! Nodes is running'),
    });
  }
}
