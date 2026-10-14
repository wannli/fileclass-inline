import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, start, deferred } from './capture-fixture.mjs';

function changeTarget(f, original, mode) {
  const path = original.path;
  if (mode === 'replaced') return f.add(path, 'Replacement must stay untouched');
  f.files.delete(path);
  if (mode === 'renamed') {
    const content = f.contents.get(path);
    f.contents.delete(path);
    original.path = 'Moved/Ada.md';
    f.files.set(original.path, original);
    f.contents.set(original.path, content);
    return original;
  }
  f.contents.delete(path);
}

for (const intent of ['open', 'link']) for (const mode of ['replaced', 'renamed', 'deleted']) {
  test(`${intent} callback awaiting completion: ${mode} target never starts required-field completion`, async () => {
    const f = fixture(), entered = deferred(), release = deferred();
    const source = f.add('Reading/Source.md');
    let original;
    const pending = f.capture.run({ type: 'person', suggestedTitle: 'Ada', inline: true,
      ...(intent === 'link' ? { sourcePath: source.path } : {}),
    }, async record => {
      original = record.file;
      assert.equal(f.index.all()[0].file, original);
      entered.resolve();
      await release.promise;
    });
    await entered.promise;
    assert.equal(f.counts.required, 0);
    const survivor = changeTarget(f, original, mode);
    release.resolve();
    await pending;
    assert.equal(f.counts.required, 0);
    assert.equal(f.events.includes('required'), false);
    assert.equal(f.app.dialogs.length, 0);
    assert.equal(f.counts.forbidden, 0);
    assert.equal(f.counts.writes, 1);
    if (survivor) assert.equal(f.files.get(survivor.path), survivor);
    if (mode === 'replaced') assert.equal(f.contents.get(survivor.path), 'Replacement must stay untouched');
    if (mode === 'renamed') assert.match(f.contents.get(survivor.path), /# Ada/);
  });
}

for (const mode of ['replaced', 'deleted']) {
  test(`API target ${mode} while awaiting its link callback returns null, not a stale result`, async () => {
    const f = fixture(), entered = deferred(), release = deferred();
    const source = f.add('Reading/Source.md');
    let original;
    const { pending } = await start(f, { sourcePath: source.path }, async node => {
      original = f.files.get(node.path);
      f.contents.set(source.path, `[[${node.path}]]`);
      entered.resolve();
      await release.promise;
    });
    await entered.promise;
    changeTarget(f, original, mode);
    release.resolve();
    assert.equal(await pending, null);
    assert.equal(f.api.getNode('Nodes/Ada.md'), null);
    assert.equal(f.counts.required, 0);
    assert.equal(f.counts.forbidden, 0);
    assert.equal(f.contents.get(source.path), '[[Nodes/Ada.md]]');
    if (mode === 'replaced') assert.equal(f.contents.get('Nodes/Ada.md'), 'Replacement must stay untouched');
  });
}

test('standalone API rechecks target identity after required completion before exposing a result', async () => {
  const f = fixture(), entered = deferred(), release = deferred();
  f.hooks.required = async () => { entered.resolve(); await release.promise; return []; };
  const { pending } = await start(f);
  await entered.promise;
  const original = f.files.get('Nodes/Ada.md');
  changeTarget(f, original, 'replaced');
  release.resolve();
  assert.equal(await pending, null);
  assert.equal(f.api.getNode(original.path), null);
  assert.equal(f.contents.get(original.path), 'Replacement must stay untouched');
  assert.equal(f.counts.forbidden, 0);
  assert.equal(f.app.dialogs.length, 1); // Only the already-closed name prompt.
});
