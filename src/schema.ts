import { App, parseYaml } from 'obsidian';

export type FieldKind = 'text' | 'number' | 'checkbox' | 'date' | 'select' | 'link' | 'text-list';
export interface Field { kind: FieldKind; requiredOnCreate?: boolean; default?: unknown; options?: string[]; targetType?: string }
export interface NodeSchema { nodeSchema: number; nodeType: string; label: string; properties: Record<string, Field>; template: string; path: string }
export interface Diagnostic { path: string; message: string }
export interface Catalog { schemas: NodeSchema[]; diagnostics: Diagnostic[] }
const kinds = new Set(['text', 'number', 'checkbox', 'date', 'select', 'link', 'text-list']);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export const missing = (value: unknown): boolean => value === null || value === undefined ||
  (typeof value === 'string' && !value.trim()) || (Array.isArray(value) && !value.length);

export function fieldError(field: Field, value: unknown): string | null {
  switch (field.kind) {
    case 'text': return typeof value === 'string' ? null : 'enter text';
    case 'checkbox': return typeof value === 'boolean' ? null : 'choose yes or no';
    case 'number': return typeof value === 'number' && Number.isFinite(value) ? null : 'enter a finite number';
    case 'select': return typeof value === 'string' && field.options?.includes(value) ? null : 'choose an option';
    case 'text-list': return Array.isArray(value) && value.every(v => typeof v === 'string') ? null : 'enter text values';
    case 'link': return typeof value === 'string' && /^\[\[[^\[\]|\r\n]+(?:\|[^\[\]\r\n]+)?\]\]$/.test(value) ? null : 'choose a node link';
    case 'date': {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'enter YYYY-MM-DD';
      const [y, m, d] = value.split('-').map(Number);
      const date = new Date(0); date.setUTCFullYear(y, m - 1, d);
      return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? null : 'enter a real calendar date';
    }
  }
}

export function validateSchema(meta: unknown, template: string, path: string): { schema?: NodeSchema; errors: string[] } {
  if (!object(meta) || !Object.hasOwn(meta, 'nodeSchema')) return { errors: [] };
  const errors: string[] = [];
  if (meta.nodeSchema !== 1) errors.push('nodeSchema: expected 1');
  if (typeof meta.nodeType !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(meta.nodeType)) errors.push('nodeType: expected stable type ID');
  if (meta.label !== undefined && (typeof meta.label !== 'string' || !meta.label.trim())) errors.push('label: expected text');
  for (const key of Object.keys(meta)) if (!['nodeSchema', 'nodeType', 'label', 'properties'].includes(key)) errors.push(`${key}: unknown schema setting`);
  if (meta.properties !== undefined && !object(meta.properties)) errors.push('properties: expected mapping');
  const properties: Record<string, Field> = Object.create(null);
  if (object(meta.properties)) for (const [name, definition] of Object.entries(meta.properties)) {
    if (!name.trim() || ['type', 'schema', '__proto__', 'prototype', 'constructor'].includes(name)) { errors.push(`${name}: reserved property`); continue; }
    if (!object(definition) || !kinds.has(definition.kind as string)) { errors.push(`${name}: invalid kind`); continue; }
    const kind = definition.kind as FieldKind;
    for (const key of Object.keys(definition)) if (!['kind', 'requiredOnCreate', 'default', 'options', 'targetType'].includes(key)) errors.push(`${name}.${key}: unknown setting`);
    if (definition.requiredOnCreate !== undefined && typeof definition.requiredOnCreate !== 'boolean') errors.push(`${name}.requiredOnCreate: expected boolean`);
    if (kind === 'select') {
      if (!Array.isArray(definition.options) || !definition.options.length || !definition.options.every(v => typeof v === 'string' && !!v.trim()) || new Set(definition.options).size !== definition.options.length) errors.push(`${name}.options: expected unique nonempty text options`);
    } else if (definition.options !== undefined) errors.push(`${name}.options: only valid for select`);
    if (definition.targetType !== undefined && (kind !== 'link' || typeof definition.targetType !== 'string' || !definition.targetType.trim())) errors.push(`${name}.targetType: only a link may target a type`);
    const field = definition as unknown as Field;
    if (Object.hasOwn(definition, 'default') && (fieldError(field, definition.default) || (field.requiredOnCreate && missing(definition.default)))) errors.push(`${name}.default: invalid default`);
    properties[name] = field;
  }
  for (const match of template.matchAll(/\{\{([^{}]*)\}\}/g)) {
    const key = match[1];
    if (key !== 'title' && key !== 'date' && !(key.startsWith('property:') && Object.hasOwn(properties, key.slice(9)))) errors.push(`template: unknown ${match[0]}`);
  }
  if (errors.length) return { errors };
  return { errors, schema: { nodeSchema: meta.nodeSchema as number, nodeType: meta.nodeType as string, label: (meta.label as string | undefined) ?? meta.nodeType as string,
    properties, template, path } };
}

/** Fresh vault reads keep schema changes live, without an extra observer or stale metadata. */
export async function loadSchemas(app: App, folder = 'Schemas'): Promise<Catalog> {
  const schemas: NodeSchema[] = [], diagnostics: Diagnostic[] = [];
  const files = app.vault.getMarkdownFiles().filter(file => file.path.startsWith(`${folder}/`)).sort((a, b) => a.path.localeCompare(b.path));
  for (const file of files) {
    let content: string;
    try { content = (await app.vault.cachedRead(file)).replace(/^\uFEFF/, ''); }
    catch (e) { diagnostics.push({ path: file.path, message: `cannot read: ${String(e)}` }); continue; }
    const lines = content.split(/\r?\n/);
    if (lines[0] !== '---') continue;
    const end = lines.findIndex((line, index) => index > 0 && (line === '---' || line === '...'));
    if (end < 0) { diagnostics.push({ path: file.path, message: 'frontmatter: missing closing ---' }); continue; }
    let meta: unknown;
    try { meta = parseYaml(lines.slice(1, end).join('\n')); }
    catch (e) { diagnostics.push({ path: file.path, message: `invalid YAML: ${String(e)}` }); continue; }
    const result = validateSchema(meta, lines.slice(end + 1).join('\n'), file.path);
    for (const message of result.errors) diagnostics.push({ path: file.path, message });
    if (result.schema) schemas.push(result.schema);
  }
  const duplicates = new Map<string, string[]>();
  for (const schema of schemas) duplicates.set(schema.nodeType, [...(duplicates.get(schema.nodeType) ?? []), schema.path]);
  for (const [type, paths] of duplicates) if (paths.length > 1) for (const path of paths) diagnostics.push({ path, message: `duplicate type ${type}: ${paths.join(', ')}` });
  const unique = schemas.filter(schema => duplicates.get(schema.nodeType)?.length === 1);
  const propertyKinds = new Map<string, { kind: string; path: string }>();
  for (const schema of unique) for (const [name, field] of Object.entries(schema.properties)) {
    const nativeKind = field.kind === 'select' || field.kind === 'link' ? 'text' : field.kind === 'text-list' ? 'list' : field.kind;
    const previous = propertyKinds.get(name);
    if (previous && previous.kind !== nativeKind) diagnostics.push({ path: schema.path, message: `property ${name}: ${nativeKind} conflicts with ${previous.kind} in ${previous.path} (Obsidian property types are vault-wide)` });
    else if (!previous) propertyKinds.set(name, { kind: nativeKind, path: schema.path });
  }
  return { schemas: unique.sort((a, b) => a.label.localeCompare(b.label)), diagnostics };
}
