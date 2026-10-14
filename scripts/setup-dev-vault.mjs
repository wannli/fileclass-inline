import { readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const vault = join(root, 'dummy-vault');
const config = join(vault, '.obsidian');
const plugins = join(config, 'plugins');
const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
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
  const files = await Promise.all(['manifest.json', 'main.js'].map(async name => {
    const response = await fetch(`${base}/${name}`);
    if (!response.ok) throw new Error(`Hot Reload download failed (${response.status}): ${name}`);
    return [name, await response.text()];
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
  if (!(await exists(hotManifest)) || !(await exists(hotMain)) || JSON.parse(await readFile(hotManifest, 'utf8')).id !== 'hot-reload') {
    throw new Error(`Incomplete or unexpected Hot Reload installation: ${hotReload}`);
  }
} else {
  await downloadHotReload();
}

const enabledPath = join(config, 'community-plugins.json');
const enabled = (await exists(enabledPath)) ? JSON.parse(await readFile(enabledPath, 'utf8')) : [];
if (!Array.isArray(enabled) || enabled.some(id => typeof id !== 'string')) throw new Error(`Unexpected plugins configuration: ${enabledPath}`);
for (const id of ['hot-reload', manifest.id]) if (!enabled.includes(id)) enabled.push(id);
await writeFile(enabledPath, JSON.stringify(enabled, null, 2) + '\n');

const appPath = join(config, 'app.json');
const app = (await exists(appPath)) ? JSON.parse(await readFile(appPath, 'utf8')) : {};
if (!app || Array.isArray(app) || typeof app !== 'object') throw new Error(`Unexpected vault configuration: ${appPath}`);
await writeFile(appPath, JSON.stringify({ ...app, safeMode: false }, null, 2) + '\n');
console.log(`Development vault ready: ${vault}`);
