import { App, stringifyYaml, TFile, TFolder } from 'obsidian';
import type { NodeSchema, Field } from './schema';
import { fieldError, missing } from './schema';
import { NodeIndex } from './index';

export type Values = Record<string, unknown>;
export interface CreatedNode { file: TFile; content: string }

/** Values entered beyond schema defaults, or copied selection text, must never be auto-removed. */
export function inferableOnly(schema: NodeSchema, values: Values, selectedBody?: string): boolean {
  return !selectedBody && Object.entries(values).every(([name, value]) =>
    Object.hasOwn(schema.properties, name) && JSON.stringify(value) === JSON.stringify(schema.properties[name].default));
}

export function titleError(title: string): string | null {
  if (!title.trim() || title !== title.trim() || title === '.' || title === '..') return 'Enter a filename without surrounding spaces';
  if (/[\\/:*?"<>|\x00-\x1f]/.test(title) || /[. ]$/.test(title)) return 'Name contains invalid filename characters';
  return null;
}
export function resolved(field: Field, values: Values, name: string): unknown {
  return Object.hasOwn(values, name) ? values[name] : field.default;
}
export function validateValues(schema: NodeSchema, values: Values): string[] {
  const errors: string[] = [];
  for (const [name, field] of Object.entries(schema.properties)) {
    const value = resolved(field, values, name);
    if (missing(value)) { if (field.requiredOnCreate) errors.push(`${name}: required`); continue; }
    const error = fieldError(field, value);
    if (error) errors.push(`${name}: ${error}`);
  }
  return errors;
}

export function renderNode(schema: NodeSchema, title: string, values: Values, date: string, selectedBody?: string): string {
  const errors = [titleError(title), ...validateValues(schema, values)].filter(Boolean);
  if (errors.length) throw new Error(errors.join('; '));
  const props: Values = Object.create(null);
  props.type = schema.nodeType;
  props.schema = schema.nodeSchema;
  for (const [name, field] of Object.entries(schema.properties)) {
    const value = resolved(field, values, name);
    if (!missing(value)) props[name] = value;
  }
  const template = schema.template.replace(/\{\{([^{}]+)\}\}/g, (_token, key: string) => {
    if (key === 'title') return title;
    if (key === 'date') return date;
    if (key.startsWith('property:') && Object.hasOwn(schema.properties, key.slice(9))) {
      const value = props[key.slice(9)];
      return Array.isArray(value) ? value.join(', ') : String(value ?? '');
    }
    throw new Error(`Unknown placeholder: {{${key}}}`);
  });
  return `---\n${stringifyYaml(props).trimEnd()}\n---\n${template}${selectedBody ? `\n\n${selectedBody}` : ''}`;
}

export async function createNode(app: App, index: NodeIndex, schema: NodeSchema, title: string, values: Values, folder = 'Nodes', selectedBody?: string): Promise<CreatedNode> {
  const now = new Date();
  const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
  const content = renderNode(schema, title, values, date, selectedBody);
  const path = `${folder}/${title}.md`;
  for (const [name, field] of Object.entries(schema.properties)) {
    const value = resolved(field, values, name);
    if (field.kind !== 'link' || missing(value)) continue;
    const linkpath = (value as string).slice(2, -2).split('|')[0];
    const target = app.metadataCache.getFirstLinkpathDest(linkpath, path);
    if (!target || !index.all().some(entry => entry.file.path === target.path && (!field.targetType || entry.type === field.targetType))) {
      throw new Error(`${name}: choose an existing ${field.targetType ?? 'typed'} node`);
    }
  }
  const existingFolder = app.vault.getAbstractFileByPath(folder);
  if (existingFolder && !(existingFolder instanceof TFolder)) throw new Error(`${folder} is a file, not a folder`);
  if (app.vault.getAbstractFileByPath(path)) throw new Error(`Node already exists at ${path}`);
  if (!existingFolder) {
    const segments = folder.split('/');
    for (let i = 1; i <= segments.length; i++) {
      const segment = segments.slice(0, i).join('/');
      const existing = app.vault.getAbstractFileByPath(segment);
      if (existing && !(existing instanceof TFolder)) throw new Error(`${segment} is a file`);
      if (!existing) try { await app.vault.createFolder(segment); }
      catch (error) { if (!(app.vault.getAbstractFileByPath(segment) instanceof TFolder)) throw error; }
    }
  }
  // Vault.create refuses a racing duplicate; never use modify() here.
  return { file: await app.vault.create(path, content), content };
}
