import { build, context } from 'esbuild';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
const watch = process.argv.includes('--watch');
const release = process.argv.includes('--release');
if (watch === release) throw new Error('Choose --watch or --release');

if (watch) await import('./setup-dev-vault.mjs');
const outdir = release ? join(root, 'dist') : join(root, 'dummy-vault', '.obsidian', 'plugins', manifest.id);
await mkdir(outdir, { recursive: true });
await writeFile(join(outdir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

const options = {
  entryPoints: [join(root, 'src', 'main.ts')],
  outfile: join(outdir, 'main.js'),
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  target: 'es2022',
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*'],
  logLevel: 'info',
};
if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log(`Watching src/ → ${outdir}`);
} else {
  await build(options);
  console.log(`Release files: ${outdir}`);
}
