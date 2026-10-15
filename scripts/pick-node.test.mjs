import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, tick, deferred, TFile } from './capture-fixture.mjs';

function pick(f, options = {}, link = async () => {}) {
  const source = f.files.get('Source.md') ?? f.add('Source.md', 'unchanged');
  const pending = f.api.pickNodeForLink({ sourcePath: source.path, ...options }, link);
  return { pending, picker: f.app.dialog, source };
}
function choose(picker, choice) {
  picker.close(); // Native SuggestModal closes BEFORE delivering the choice.
  picker.onChooseSuggestion(choice);
}
async function existing(f) {
  const file = f.add('Elsewhere/Ada.md');
  f.state.members = [{ path: file.path, classes: ['person'] }];
  await f.index.rebuild();
  return file;
}

test('shared picker seeds query, only lists typed notes, and always offers Create', async () => {
  const f = fixture(); await existing(f); f.add('Untyped.md');
  const { pending, picker } = pick(f, { suggestedTitle: 'Missing' });
  assert.equal(picker.inputEl.value, 'Missing');
  assert.deepEqual(picker.getSuggestions('Missing'), [{ kind: 'create', title: 'Missing' }]);
  assert.deepEqual(picker.getSuggestions('').map(c => c.kind), ['existing', 'create']);
  assert.equal(picker.getSuggestions('').at(-1).title, '');
  picker.close(); assert.equal(await pending, null);
  assert.equal(f.counts.writes, 0);
});

test('existing selection links a snapshot and permits intentional source promotion', async () => {
  const f = fixture(), target = await existing(f);
  const { pending, picker, source } = pick(f, {}, async node => {
    assert.equal(node.path, target.path); node.classes.push('external');
    f.files.delete(source.path); source.path = 'Inbox/Source.md'; f.files.set(source.path, source);
  });
  choose(picker, picker.getSuggestions('Ada')[0]);
  assert.deepEqual((await pending).classes, ['person']);
  assert.equal(f.counts.required, 0); assert.equal(f.counts.writes, 0);
  assert.equal(f.counts.forbidden, 0);
});

test('inline Create chooses class, avoids redundant name dialog, links before completion', async () => {
  const f = fixture(); let calls = 0;
  const { pending, picker } = pick(f, { suggestedTitle: 'Ada' }, async () => {
    calls++; assert.equal(f.counts.required, 0);
  });
  choose(picker, picker.getSuggestions('Ada').at(-1)); await tick();
  const classes = f.app.dialog;
  assert.notEqual(classes, picker);
  classes.onChooseSuggestion(f.state.types[0]); await tick();
  assert.equal((await pending).path, 'Nodes/Ada.md');
  assert.equal(calls, 1); assert.equal(f.counts.required, 1);
  assert.equal(f.app.dialogs.length, 2);
  assert.equal(f.contents.get('Source.md'), 'unchanged');
});

test('empty Create opens the shared name prompt', async () => {
  const f = fixture(); f.state.types = [f.state.types[0]];
  const { pending, picker } = pick(f);
  choose(picker, picker.getSuggestions('').at(-1)); await tick();
  f.submit('Named'); assert.equal((await pending).title, 'Named');
});

for (const create of [false, true]) for (const failure of [new Error('guard'), undefined]) {
  test(`callback rejection propagates and retains target (create=${create}, ${String(failure)})`, async () => {
    const f = fixture(); f.state.types = [f.state.types[0]];
    if (!create) await existing(f);
    const { pending, picker } = pick(f, {}, async () => { throw failure; });
    const rejected = assert.rejects(pending, error => error === failure);
    choose(picker, create ? { kind: 'create', title: 'Ada' } : picker.getSuggestions('Ada')[0]);
    await rejected;
    assert.ok(f.files.has(create ? 'Nodes/Ada.md' : 'Elsewhere/Ada.md'));
    assert.equal(f.counts.required, 0);
  });
}

for (const mode of ['abort', 'dispose', 'cancelAll']) test(`${mode} closes picker and settles requests`, async () => {
  const f = fixture(), controller = new AbortController();
  const { pending, picker } = pick(f, { signal: controller.signal });
  if (mode === 'abort') controller.abort(); else f.api[mode]();
  assert.equal(await pending, null); assert.equal(picker.closed, true);
  picker.onChooseSuggestion({ kind: 'create', title: 'Late' }); await tick();
  assert.equal(f.counts.writes, 0);
});

test('abort settles an uncooperative existing callback and observes its late rejection', async () => {
  const f = fixture(), controller = new AbortController(), blocked = deferred(); await existing(f);
  const { pending, picker } = pick(f, { signal: controller.signal }, () => blocked.promise);
  choose(picker, picker.getSuggestions('Ada')[0]); await tick(); controller.abort();
  assert.equal(await pending, null); blocked.reject(new Error('late')); await tick();
});

for (const target of [false, true]) test(`stale ${target ? 'target' : 'source'} prevents callback`, async () => {
  const f = fixture(), file = await existing(f);
  const { pending, picker, source } = pick(f, {}, async () => assert.fail('stale callback'));
  const choice = picker.getSuggestions('Ada')[0];
  const stale = target ? file : source; f.files.set(stale.path, new TFile(stale.path));
  choose(picker, choice); assert.equal(await pending, null);
});

for (const mode of ['class removal', 'backend replacement', 'target replacement during lookup']) {
  test(`${mode} skips existing callback`, async () => {
    const f = fixture(), file = await existing(f);
    const { pending, picker } = pick(f, {}, async () => assert.fail('stale callback'));
    if (mode === 'backend replacement') f.state.token = {};
    f.hooks.classes = async () => {
      if (mode === 'target replacement during lookup') f.files.set(file.path, new TFile(file.path));
      return mode === 'class removal' ? [] : ['person'];
    };
    choose(picker, picker.getSuggestions('Ada')[0]); assert.equal(await pending, null);
  });
}

for (const mode of ['rebuild before selection', 'update during lookup', 'changed classes']) {
  test(`${mode} reconciles fresh same-file snapshots before callback`, async () => {
    const f = fixture(), file = await existing(f), lookup = deferred(); let calls = 0;
    const { pending, picker } = pick(f, {}, async node => {
      calls++;
      assert.deepEqual(f.api.getNode(node.path), node);
      assert.equal(node.type, mode === 'changed classes' ? 'author' : 'person');
    });
    const choice = picker.getSuggestions('Ada')[0];
    if (mode === 'rebuild before selection') await f.index.rebuild();
    if (mode === 'update during lookup') f.hooks.classes = () => lookup.promise;
    if (mode === 'changed classes') f.hooks.classes = async () => ['person', 'author'];
    choose(picker, choice);
    if (mode === 'update during lookup') {
      f.index.remember(file, ['author']); lookup.resolve(['person']);
    }
    assert.equal((await pending).path, file.path); assert.equal(calls, 1);
  });
}

test('already aborted, missing source, and disconnected calls never open picker', async () => {
  const f = fixture();
  const signal = AbortSignal.abort();
  assert.equal(await f.api.pickNodeForLink({ sourcePath: 'Missing.md' }, async () => {}), null);
  assert.equal(await pick(f, { signal }).pending, null);
  f.state.connected = false; assert.equal(await pick(f).pending, null);
  assert.equal(f.app.dialogs.length, 0);
});
