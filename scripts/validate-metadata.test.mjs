import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateMetadata } from './validate-metadata.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'nodes-metadata-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const name of ['manifest.json', 'package.json', 'package-lock.json', 'versions.json'])
    await writeFile(join(directory, name), await readFile(join(root, name)));
  return directory;
}
async function change(directory, file, update) {
  const path = join(directory, file);
  const data = JSON.parse(await readFile(path, 'utf8'));
  update(data);
  await writeFile(path, JSON.stringify(data));
}

test('current metadata and exact numeric tag are accepted', async () => {
  const manifest = await validateMetadata(root);
  await validateMetadata(root, { refType: 'tag', refName: manifest.version });
  for (const tag of [`v${manifest.version}`, '999.0.0'])
    await assert.rejects(validateMetadata(root, { refType: 'tag', refName: tag }), /Tag must equal/);
});

for (const [file, update, message] of [
  ['package.json', data => { data.version = '999.0.0'; }, /Package version mismatch/],
  ['package-lock.json', data => { data.version = '999.0.0'; }, /Lockfile version mismatch/],
  ['package-lock.json', data => { data.packages[''].version = '999.0.0'; }, /Lockfile root version mismatch/],
  ['manifest.json', data => { data.id = 'other'; }, /Wrong plugin ID/],
  ['manifest.json', data => { data.minAppVersion = '99.0.0'; }, /Minimum host version mismatch/],
  ['versions.json', data => { for (const key of Object.keys(data)) delete data[key]; }, /Missing minimum host mapping/],
]) {
  test(`rejects ${message.source}`, async t => {
    const directory = await fixture(t);
    await change(directory, file, update);
    await assert.rejects(validateMetadata(directory), message);
  });
}

test('later releases may reuse the unchanged minimum host mapping', async t => {
  const directory = await fixture(t);
  await change(directory, 'manifest.json', data => { data.version = '999.0.0'; });
  await change(directory, 'package.json', data => { data.version = '999.0.0'; });
  await change(directory, 'package-lock.json', data => {
    data.version = '999.0.0';
    data.packages[''].version = '999.0.0';
  });
  await validateMetadata(directory);
});
