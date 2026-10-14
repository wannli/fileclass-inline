import { readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const vault = join(root, 'dummy-vault');
const config = join(vault, '.obsidian');
const plugins = join(config, 'plugins');
const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.id)) throw new Error('Invalid development plugin ID');
const plugin = join(plugins, manifest.id);
const hotReload = join(plugins, 'hot-reload');
const vaultMarker = join(vault, '.fileclass-inline-dev-vault');
const pluginMarker = join(plugin, '.fileclass-inline-dev-plugin');

async function exists(path) {
  try { return await lstat(path); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function requireOwnedDirectory(path, marker, label) {
  const stat = await exists(path);
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink() || !(await exists(marker)))) {
    throw new Error(`Refusing to use existing ${label}: ${path} (missing ownership marker or not a real directory)`);
  }
  if (stat && !(await exists(marker)).isFile()) throw new Error(`Invalid ownership marker: ${marker}`);
  if (!stat) {
    await mkdir(path, { recursive: true });
    await writeFile(marker, 'Created by scripts/setup-dev-vault.mjs\n', { flag: 'wx' });
  }
}

async function assertRealDirectory(path) {
  const stat = await exists(path);
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new Error(`Expected real directory: ${path}`);
}

async function downloadHotReload() {
  const version = '0.3.1';
  const base = `https://github.com/pjeby/hot-reload/releases/download/${version}`;
  const hashes = {
    'manifest.json': '62bab306528e1ba54382417f1cb6b78ae1e4e9a00e3169b812818949273d32f8',
    'main.js': '41e1aa3841c08fe789160fae73f24b723d30e18f9ed5cda55c49110ce02d7601',
  };
  const files = await Promise.all(Object.entries(hashes).map(async ([name, hash]) => {
    const response = await fetch(`${base}/${name}`);
    if (!response.ok) throw new Error(`Hot Reload download failed (${response.status}): ${name}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error(`Hot Reload checksum mismatch: ${name}`);
    return [name, bytes];
  }));
  const data = Object.fromEntries(files);
  if (JSON.parse(data['manifest.json']).id !== 'hot-reload' || !data['main.js'].length) {
    throw new Error('Downloaded Hot Reload files failed validation');
  }
  await mkdir(hotReload);
  for (const [name, content] of files) await writeFile(join(hotReload, name), content, { flag: 'wx' });
}

await requireOwnedDirectory(vault, vaultMarker, 'vault');
await assertRealDirectory(config);
await assertRealDirectory(plugins);
for (const folder of ['Classes', 'Nodes']) await assertRealDirectory(join(vault, folder));
await mkdir(plugins, { recursive: true });
await requireOwnedDirectory(plugin, pluginMarker, 'development plugin');

const installedManifest = join(plugin, 'manifest.json');
const currentManifest = await exists(installedManifest);
if (currentManifest && (!currentManifest.isFile() || currentManifest.isSymbolicLink() || JSON.parse(await readFile(installedManifest, 'utf8')).id !== manifest.id)) {
  throw new Error(`Refusing to replace unexpected manifest: ${installedManifest}`);
}
await writeFile(installedManifest, JSON.stringify(manifest, null, 2) + '\n');
const reloadMarker = join(plugin, '.hotreload');
if (!(await exists(reloadMarker))) await writeFile(reloadMarker, '');

const hotStat = await exists(hotReload);
if (hotStat) {
  if (!hotStat.isDirectory() || hotStat.isSymbolicLink()) throw new Error(`Unexpected Hot Reload path: ${hotReload}`);
  const hotManifest = join(hotReload, 'manifest.json');
  const hotMain = join(hotReload, 'main.js');
  if (!(await exists(hotManifest))?.isFile() || !(await exists(hotMain))?.isFile() || JSON.parse(await readFile(hotManifest, 'utf8')).id !== 'hot-reload') {
    throw new Error(`Incomplete or unexpected Hot Reload installation: ${hotReload}`);
  }
} else {
  await downloadHotReload();
}

// Fileclass owns its settings and installation. Do not write its raw data or
// enable any plugins here. Exclusive creation also preserves edited/older notes.
const seeds = {
  'Classes/Person.md': `---
icon: user-round
fields:
  - name: email
    id: person-email
    type: Input
    options: {}
    path: ""
---
# Person

Optional email only; capturing a Person needs no required-field form.
`,
  'Classes/Task.md': `---
icon: check-square
fields:
  - name: summary
    id: task-summary
    type: Input
    options:
      required: true
    path: ""
  - name: notes
    id: task-notes
    type: Input
    options: {}
    path: ""
---
# Task

Summary is required. Notes are optional and never appear in FileClass Inline's completion form.
`,
  'Nodes/Ada Lovelace.md': `---
fileClass: Person
---
# Ada Lovelace

Disposable Person fixture with no required fields.
`,
  'Nodes/Example task.md': `---
fileClass: Task
summary: Try Fileclass-backed capture
---
# Example task

Create a new Task to try required summary completion; optional notes stay out of the form.
`,
  'Start.md': `# FileClass Inline development vault

Use this isolated dummy vault only, never a personal vault. Existing notes and
settings are preserved; older fixtures are not migrated or removed.

## Manual setup (required)

1. Use Obsidian **1.12.7 or later**. Build FileClass Inline with npm run dev from the repository.
2. Install and enable [Fileclass](https://github.com/mdelobelle/fileclass) manually
   in this vault, using a release with **public API v1** (reviewed: 0.2.15).
3. In **Fileclass settings**, explicitly set the **class folder to Classes** and
   the **fileClass alias to fileClass**. Creating Classes/ alone does not configure
   Fileclass. Confirm that Fileclass lists Person and Task before testing FileClass Inline.
4. In this vault's Community plugins settings, manually enable **FileClass Inline** and
   **Hot Reload**. Setup downloads only pinned Hot Reload; it does not enable
   plugins, change restricted mode, install Fileclass or write Fileclass settings.
5. Keep FileClass Inline's capture folder **Nodes** and class binding property **fileClass**
   (the defaults). Run **FileClass Inline: Check Fileclass connection** to refresh the catalog.

## Try the fixtures

- Type @Ada to link the seeded Person with its user-round icon.
- Create a new Person: optional email must not open a completion form.
- Create a new Task: only required summary opens the completion form; optional
  notes do not. Closing the form keeps the created note and any inserted link.
- Edit optional properties later through Fileclass or Obsidian Properties.

Fileclass owns class definitions in Classes/. FileClass Inline creates ordinary Markdown
in Nodes/ with a fileClass binding and does not prune captured notes. Existing notes are never overwritten by setup.
`,
};
for (const folder of ['Classes', 'Nodes']) await mkdir(join(vault, folder), { recursive: true });
for (const [name, content] of Object.entries(seeds)) {
  try { await writeFile(join(vault, name), content, { flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
}
console.log(`Development vault ready: ${vault}`);
console.log('Manual setup: Obsidian >=1.12.7; install/enable Fileclass public API v1, set its class folder to Classes and alias to fileClass, then enable FileClass Inline and Hot Reload. Existing notes/settings were preserved; see Start.md for new-vault instructions.');
