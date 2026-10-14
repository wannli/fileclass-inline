import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, start, tick, deferred, TFile } from './capture-fixture.mjs';

test('v2 reads are synchronous cached snapshots with all classes, aliases and icons, never colors', async () => {
  const f = fixture();
  const file = f.add('People/Ada.md', '', { type: 'wrong', aliases: ['Countess'], color: 'green' });
  f.state.members = [{ path: file.path, classes: ['person', 'author'] }];
  f.state.types[1].color = 'purple'; // A legacy field must never leak into the public API.
  await f.index.rebuild();
  const before = { ...f.counts };
  assert.equal(f.api.version, 2);
  assert.deepEqual(f.api.listTypes(), [{ type: 'person', label: 'person', icon: 'user-round' }, { type: 'author', label: 'author', icon: 'notebook-pen' }]);
  const result = f.api.searchNodes('Countess')[0];
  assert.deepEqual(result, { path: file.path, title: 'Ada', type: 'author', classes: ['person', 'author'], aliases: ['Countess'], icon: 'notebook-pen' });
  result.classes.push('leaked'); result.aliases.push('leaked'); result.title = 'Changed';
  const types = f.api.listTypes(); types[0].icon = 'changed'; types.push({ type: 'fake' });
  assert.deepEqual(f.api.getNode(file.path).classes, ['person', 'author']);
  assert.deepEqual(f.api.getNode(file.path).aliases, ['Countess']);
  assert.equal(f.api.listTypes()[0].icon, 'user-round');
  assert.equal(f.api.getNode(file.path).title, 'Ada');
  assert.equal(f.api.getNode('Missing.md'), null);
  assert.deepEqual(f.counts, before);
});

test('API search is not limited to 20; replaced identities disappear without a rebuild', async () => {
  const f = fixture();
  f.state.members = Array.from({ length: 25 }, (_, i) => ({ path: f.add(`Anywhere/Node ${i}.md`).path, classes: ['person'] }));
  await f.index.rebuild();
  assert.equal(f.api.searchNodes('').length, 25);
  const path = f.state.members[0].path;
  f.files.set(path, new TFile(path));
  assert.equal(f.api.getNode(path), null);
  assert.equal(f.api.searchNodes('').length, 24);
});

test('standalone API creation writes convention-only Markdown and quietly finishes without fields', async () => {
  const f = fixture();
  const { pending } = await start(f, { sourcePath: 'No editor required.md' });
  const result = await pending;
  assert.deepEqual(result, { path: 'Nodes/Ada.md', title: 'Ada', type: 'person', classes: ['person'], aliases: [], icon: 'user-round' });
  assert.equal(f.contents.get(result.path), '---\nfileClass: "person"\n---\n# Ada\n');
  assert.equal(f.counts.writes, 1);
  assert.equal(f.counts.required, 1);
  assert.equal(f.app.dialogs.length, 1); // Name prompt only: no empty required form.
  assert.ok(f.app.dialogs.every(dialog => dialog.closed));
  assert.equal(f.api.getNode(result.path).path, result.path); // remember(), not a backend rescan.
  assert.equal(f.counts.members, 0);
  assert.equal(f.counts.forbidden, 0);
});

test('confirmed binding and remember precede API link callback; required completion follows it', async () => {
  const f = fixture(), completion = deferred();
  const source = f.add('Reading/Book.md', 'existing source');
  f.hooks.classes = async () => ['author', 'person'];
  f.hooks.created = file => f.metadata.set(file, { frontmatter: { aliases: ['Countess'] } });
  f.hooks.required = () => completion.promise;
  let linked = 0;
  const { pending } = await start(f, { sourcePath: source.path }, async node => {
    linked++; f.events.push('link');
    assert.equal(f.counts.required, 0);
    assert.equal(f.api.getNode(node.path).path, node.path);
    assert.deepEqual(node.classes, ['author', 'person']);
    assert.deepEqual(node.aliases, ['Countess']);
    assert.equal(node.icon, 'user-round'); assert.equal('color' in node, false);
    node.classes.push('external'); node.aliases.push('external');
  });
  await tick();
  assert.equal(linked, 1);
  assert.ok(f.events.indexOf('binding') < f.events.indexOf('link'));
  assert.ok(f.events.indexOf('link') < f.events.indexOf('required'));
  let settled = false; void pending.then(() => { settled = true; });
  await tick(); assert.equal(settled, false);
  completion.resolve([]);
  const result = await pending;
  assert.deepEqual(result.classes, ['author', 'person']);
  assert.deepEqual(result.aliases, ['Countess']);
  assert.deepEqual(f.api.getNode(result.path).classes, result.classes);
  assert.equal(f.contents.get(source.path), 'existing source');
  assert.equal(f.counts.forbidden, 0);
});

for (const mode of ['replaced', 'deleted', 'renamed']) test(`API source ${mode} before callback retains note but skips link and completion`, async () => {
  const f = fixture(), source = f.add('Reading/Book.md');
  f.hooks.classes = async () => {
    if (mode === 'replaced') f.files.set(source.path, new TFile(source.path));
    if (mode === 'deleted') f.files.delete(source.path);
    if (mode === 'renamed') source.path = 'Moved.md';
    return ['person'];
  };
  let links = 0;
  const { pending } = await start(f, { sourcePath: source.path }, async () => { links++; });
  assert.equal((await pending).path, 'Nodes/Ada.md');
  assert.equal(links, 0); assert.equal(f.counts.required, 0);
  assert.ok(f.files.has('Nodes/Ada.md'));
});

test('missing and fake source files never open prompts or start writes', async () => {
  const f = fixture();
  for (const sourcePath of ['Missing.md', 'Fake.md']) {
    if (sourcePath === 'Fake.md') f.files.set(sourcePath, { path: sourcePath });
    assert.equal(await f.api.createNodeForLink({ sourcePath }, async () => assert.fail('Unexpected link')), null);
  }
  assert.equal(f.counts.writes, 0); assert.equal(f.app.dialogs.length, 0);
});

for (const failure of [new Error('Source editor changed'), undefined, null, 'Link rejected']) {
  test(`link rejection (${String(failure)}) propagates unchanged, keeps the note, and skips completion`, async () => {
    const f = fixture(), source = f.add('Reading/Book.md');
    const { pending } = await start(f, { sourcePath: source.path }, async () => { throw failure; });
    await assert.rejects(pending, error => error === failure);
    assert.ok(f.files.has('Nodes/Ada.md'));
    assert.ok(f.api.getNode('Nodes/Ada.md'));
    assert.equal(f.counts.required, 0); assert.equal(f.counts.forbidden, 0);
  });
}

test('abort during link callback returns null without removing created note or source edits', async () => {
  const f = fixture(), controller = new AbortController(), source = f.add('Reading/Book.md');
  const { pending } = await start(f, { sourcePath: source.path, signal: controller.signal }, async node => {
    f.contents.set(source.path, `[[${node.path}]]`); controller.abort();
  });
  assert.equal(await pending, null); await tick();
  assert.ok(f.files.has('Nodes/Ada.md'));
  assert.equal(f.contents.get(source.path), '[[Nodes/Ada.md]]');
  assert.equal(f.counts.required, 0);
});

test('abort during required completion closes its form but preserves the already-linked note', async () => {
  const f = fixture(), controller = new AbortController(), source = f.add('Reading/Book.md');
  f.hooks.required = async () => [{ name: 'Required', owner: 'person', type: 'Input', value: '', options: {}, supported: true }];
  const { pending } = await start(f, { sourcePath: source.path, signal: controller.signal }, async node => {
    f.contents.set(source.path, `[[${node.path}]]`);
  });
  await tick();
  const form = f.app.dialog;
  assert.equal(form.fields[0].name, 'Required');
  controller.abort(); assert.equal(await pending, null); await tick();
  assert.equal(form.closed, true);
  assert.ok(f.files.has('Nodes/Ada.md')); assert.equal(f.contents.get(source.path), '[[Nodes/Ada.md]]');
  assert.equal(f.counts.forbidden, 0);
});

test('unknown or unavailable classes cannot create notes', async () => {
  for (const empty of [false, true]) {
    const f = fixture(); if (empty) f.state.types = [];
    assert.equal(await f.api.createNode({ type: empty ? 'person' : 'unknown' }), null);
    assert.equal(f.counts.writes, 0); assert.equal(f.app.dialogs.length, 0);
  }
});

test('disconnected and disposed APIs are inert; dispose cancels a pending prompt', async () => {
  const f = fixture();
  const pending = f.api.createNode({ type: 'person' }); await tick();
  const dialog = f.app.dialog;
  f.api.dispose();
  assert.equal(await pending, null); assert.equal(dialog.closed, true);
  for (const api of [f.api, (() => { const disconnected = fixture(); disconnected.state.connected = false; return disconnected.api; })()]) {
    assert.deepEqual(api.listTypes(), []); assert.deepEqual(api.searchNodes(''), []);
    assert.equal(api.getNode('Nodes/Ada.md'), null);
    assert.equal(await api.createNode({}), null);
    assert.equal(await api.createNodeForLink({ sourcePath: 'Any.md' }, async () => assert.fail()), null);
  }
  assert.equal(f.counts.writes, 0);
});
