import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const compare = (a, b) => {
  const left = a.split('.').map(Number), right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] - right[i];
  return 0;
};

export async function validateMetadata(directory, { refType, refName } = {}) {
  const json = async name => JSON.parse(await readFile(join(directory, name), 'utf8'));
  const manifest = await json('manifest.json');
  const pkg = await json('package.json');
  const lock = await json('package-lock.json');
  const versions = await json('versions.json');
  for (const key of ['id', 'name', 'version', 'minAppVersion', 'description', 'author'])
    assert.ok(typeof manifest[key] === 'string' && manifest[key].trim(), `Manifest ${key} must be nonempty`);
  assert.equal(manifest.id, 'obsidian-nodes', 'Wrong plugin ID');
  assert.equal(manifest.name, 'Nodes', 'Wrong plugin name');
  assert.equal(typeof manifest.isDesktopOnly, 'boolean', 'Specify platform support');
  assert.match(manifest.version, semver, 'Use numeric semver');
  assert.match(manifest.minAppVersion, semver, 'Use numeric minimum host version');
  assert.equal(pkg.name, manifest.id, 'Package identity mismatch');
  assert.equal(pkg.private, true, 'Not an npm publication');
  assert.equal(pkg.version, manifest.version, 'Package version mismatch');
  assert.equal(lock.name, pkg.name, 'Lockfile identity mismatch');
  assert.equal(lock.version, pkg.version, 'Lockfile version mismatch');
  assert.equal(lock.packages?.['']?.name, pkg.name, 'Lockfile root identity mismatch');
  assert.equal(lock.packages?.['']?.version, pkg.version, 'Lockfile root version mismatch');
  assert.ok(versions && typeof versions === 'object' && !Array.isArray(versions), 'Invalid versions map');
  for (const [version, host] of Object.entries(versions)) {
    assert.match(version, semver, 'Invalid versions map key');
    assert.ok(typeof host === 'string' && semver.test(host), 'Invalid versions map host');
  }
  // Like reader2, this is a compatibility change-point map, not a release ledger.
  const compatible = Object.keys(versions).filter(v => compare(v, manifest.version) <= 0).sort(compare).at(-1);
  assert.ok(compatible, 'Missing minimum host mapping');
  assert.equal(versions[compatible], manifest.minAppVersion, 'Minimum host version mismatch');
  if (refType === 'tag') assert.equal(refName, manifest.version, 'Tag must equal manifest.version without v');
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = await validateMetadata(root, {
    refType: process.env.GITHUB_REF_TYPE,
    refName: process.env.GITHUB_REF_NAME,
  });
  console.log(`Validated ${manifest.name} ${manifest.version}`);
}
