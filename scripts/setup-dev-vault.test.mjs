import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const setup = await readFile(new URL('./setup-dev-vault.mjs', import.meta.url), 'utf8');
const marker = 'dummy-vault/.fileclass-inline-dev-vault';
const plugin = 'dummy-vault/.obsidian/plugins/fileclass-inline';
const hot = 'dummy-vault/.obsidian/plugins/hot-reload';
const notes = ['Classes/Person.md', 'Classes/Task.md', 'Nodes/Ada Lovelace.md', 'Nodes/Example task.md', 'Start.md'];

// Never import the real setup script: its root is derived from import.meta.url.
// Run a copy under a temporary repository, with all network access stubbed.
async function fixture(t, installedHotReload = true) {
  const root = await mkdtemp(join(tmpdir(), 'nodes-setup-fixture-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const put = async (path, content = '') => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  };
  await put('scripts/setup-dev-vault.mjs', setup);
  await put('manifest.json', JSON.stringify({ id: 'fileclass-inline', version: '0.4.0' }));
  await put('no-network.mjs', 'globalThis.fetch = async () => { throw new Error("Unexpected network access"); };');
  if (installedHotReload) {
    await put(marker);
    await put(`${hot}/manifest.json`, JSON.stringify({ id: 'hot-reload', version: '0.3.1' }));
    await put(`${hot}/main.js`, '// Existing installation must not be replaced.');
  }
  return {
    root, put,
    read: path => readFile(join(root, path), 'utf8'),
    run: () => spawnSync(process.execPath, ['--import', join(root, 'no-network.mjs'), join(root, 'scripts/setup-dev-vault.mjs')], { encoding: 'utf8', timeout: 10000 }),
  };
}

function success(result) { assert.equal(result.status, 0, result.stderr); }
function refused(result, pattern) { assert.notEqual(result.status, 0); assert.match(result.stderr, pattern); }

test('setup seeds Fileclass-only examples and requires explicit manual configuration', async t => {
  const f = await fixture(t);
  const result = f.run();
  success(result);
  const person = await f.read('dummy-vault/Classes/Person.md');
  assert.match(person, /icon: user-round/);
  assert.match(person, /name: email\n    id: person-email\n    type: Input\n    options: \{\}\n    path: ""/);
  assert.doesNotMatch(person, /required: true/);
  const task = await f.read('dummy-vault/Classes/Task.md');
  assert.match(task, /icon: check-square/);
  assert.match(task, /name: summary\n    id: task-summary\n    type: Input\n    options:\n      required: true\n    path: ""/);
  assert.match(task, /name: notes\n    id: task-notes\n    type: Input\n    options: \{\}\n    path: ""/);
  for (const [name, binding] of [['Ada Lovelace', 'Person'], ['Example task', 'Task']]) {
    const content = await f.read(`dummy-vault/Nodes/${name}.md`);
    assert.match(content, new RegExp(`^---\nfileClass: ${binding}\n`));
    assert.doesNotMatch(content, /nodeSchema|nodeType/);
  }
  const start = await f.read('dummy-vault/Start.md');
  for (const text of ['1.12.7', 'public API v1', 'class folder to Classes', 'fileClass alias to fileClass', 'manually enable', 'optional', 'required']) assert.ok(start.includes(text), text);
  assert.match(result.stdout, /Manual setup:.*class folder to Classes/);
  assert.deepEqual((await readdir(join(f.root, 'dummy-vault'))).sort(), ['.obsidian', '.fileclass-inline-dev-vault', 'Classes', 'Nodes', 'Start.md'].sort());
  assert.deepEqual((await readdir(join(f.root, 'dummy-vault/.obsidian/plugins'))).sort(), ['fileclass-inline', 'hot-reload']);
  for (const name of ['app.json', 'community-plugins.json', 'plugins/fileclass-inline/data.json']) {
    await assert.rejects(f.read(`dummy-vault/.obsidian/${name}`), { code: 'ENOENT' });
  }
  const before = await Promise.all(notes.map(name => f.read(`dummy-vault/${name}`)));
  success(f.run());
  assert.deepEqual(await Promise.all(notes.map(name => f.read(`dummy-vault/${name}`))), before);
});

test('reruns preserve edited notes, legacy fixtures, settings and installed plugins byte-for-byte', async t => {
  const f = await fixture(t);
  success(f.run());
  const preserved = new Map(notes.map(name => [`dummy-vault/${name}`, `# My existing ${name}\n`]));
  preserved.set('dummy-vault/Nodes/Legacy.md', '---\nnodeType: Person\n---\nOld fixture kept, not migrated.\n');
  preserved.set('dummy-vault/Schemas/Person.md', '---\nnodeSchema: true\n---\n');
  for (const [name, content] of [
    ['app.json', '{"safeMode":true}'], ['community-plugins.json', '["another-plugin"]'],
    ['plugins/fileclass/data.json', '{"classFilesPath":"My Classes"}'],
    ['plugins/fileclass/main.js', 'DO NOT TOUCH'], ['plugins/fileclass/manifest.json', '{"id":"fileclass"}'],
    ['plugins/fileclass-inline/data.json', '{"nodesFolder":"Custom"}'],
    ['plugins/fileclass-inline/main.js', 'existing build'], ['plugins/fileclass-inline/.hotreload', 'existing marker'],
    ['plugins/hot-reload/main.js', 'existing hot reload'], ['plugins/hot-reload/manifest.json', '{"id":"hot-reload","version":"0.3.1"}'],
  ]) preserved.set(`dummy-vault/.obsidian/${name}`, content);
  for (const [path, content] of preserved) await f.put(path, content);
  const result = f.run();
  success(result);
  assert.match(result.stdout, /Manual setup:/); // Even when Start.md already exists.
  for (const [path, content] of preserved) assert.equal(await f.read(path), content, path);
});

test('unmarked existing vaults and plugin folders are protected', async t => {
  for (const target of ['dummy-vault', plugin]) await t.test(target, async t => {
    const f = await fixture(t, false);
    if (target === plugin) await f.put(marker);
    await f.put(`${target}/keep.md`, 'untouched');
    refused(f.run(), /Refusing to use existing/);
    assert.equal(await f.read(`${target}/keep.md`), 'untouched');
    await assert.rejects(f.read('dummy-vault/Start.md'), { code: 'ENOENT' });
  });
});

test('symlinked vault, ownership marker and writable directories cannot escape the fixture', async t => {
  for (const target of ['dummy-vault', marker, 'dummy-vault/.obsidian', 'dummy-vault/.obsidian/plugins', plugin, hot, 'dummy-vault/Classes', 'dummy-vault/Nodes']) {
    await t.test(target, async t => {
      const f = await fixture(t, false);
      await f.put('protected/keep.md', 'untouched');
      if (target !== 'dummy-vault' && target !== marker) await f.put(marker);
      await mkdir(dirname(join(f.root, target)), { recursive: true });
      await symlink(join(f.root, target === marker ? 'protected/keep.md' : 'protected'), join(f.root, target));
      refused(f.run(), /Refusing to use existing|Invalid ownership marker|Expected real directory|Unexpected Hot Reload path/);
      assert.equal(await f.read('protected/keep.md'), 'untouched');
      assert.deepEqual(await readdir(join(f.root, 'protected')), ['keep.md']);
    });
  }
});

test('existing note symlinks are skipped rather than followed', async t => {
  const f = await fixture(t);
  await f.put('protected.md', 'untouched');
  await mkdir(join(f.root, 'dummy-vault/Classes'));
  await symlink(join(f.root, 'protected.md'), join(f.root, 'dummy-vault/Classes/Person.md'));
  success(f.run());
  assert.equal(await f.read('protected.md'), 'untouched');
});

test('Hot Reload downloads stay pinned to 0.3.1 with SHA-256 validation before installation', async t => {
  const f = await fixture(t, false);
  assert.match(setup, /62bab306528e1ba54382417f1cb6b78ae1e4e9a00e3169b812818949273d32f8/);
  assert.match(setup, /41e1aa3841c08fe789160fae73f24b723d30e18f9ed5cda55c49110ce02d7601/);
  await f.put('no-network.mjs', `globalThis.fetch = async url => {
    if (!/^https:\\/\\/github\\.com\\/pjeby\\/hot-reload\\/releases\\/download\\/0\\.3\\.1\\/(manifest\\.json|main\\.js)$/.test(url)) throw new Error('Unexpected download: ' + url);
    console.log(url);
    return { ok: true, arrayBuffer: async () => new TextEncoder().encode('tampered').buffer };
  };`);
  const result = f.run();
  refused(result, /Hot Reload checksum mismatch/);
  assert.match(result.stdout, /0\.3\.1\/manifest\.json/);
  assert.match(result.stdout, /0\.3\.1\/main\.js/);
  await assert.rejects(readdir(join(f.root, hot)), { code: 'ENOENT' });
});
