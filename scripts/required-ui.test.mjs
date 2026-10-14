import { test } from 'node:test';
import './required-ui-choice-tests.mjs';
import './required-ui-pending-tests.mjs';
import './required-ui-date-tests.mjs';
import './required-ui-focus-tests.mjs';
import assert from 'node:assert/strict';
import { completeRequiredFields, TFile, fixture, field, tick, deferred, text, row, controls, input, button, save, check } from './required-ui-fixture.mjs';

test('no missing fields: no modal or unrelated/optional metadata inspection', async () => {
  const f = fixture(); f.state.optional = new Proxy({}, { get() { throw Error('Optional inspected'); } });
  await f.start(); assert.equal(f.app.opened, 0); assert.deepEqual(f.state.events, [['required', 'Nodes/New.md']]);
  const controller = new AbortController(); controller.abort();
  await completeRequiredFields(f.app, { token() { throw Error('Must not run'); } }, 'x', controller.signal);
});
test('all supported controls preserve false, zero, lists and full Fileclass links; optional values stay untouched', async () => {
  const types = ['Input', 'Number', 'Boolean', 'Date', 'Select', 'Cycle', 'File', 'MultiFile', 'MultiInput', 'Multi'];
  const f = fixture(types.map(type => field(type, type))); f.state.values.set('optional', ['unchanged']);
  for (const type of ['Select', 'Cycle', 'File', 'MultiFile', 'Multi']) f.state.choices[type] = [{ label: 'Shown label', value: '[[Folder/Note#Heading|Alias]]' }];
  const pending = f.start(); await tick();
  assert.match(text(f.app), /Note already created; saved fields are kept. Optional fields can be edited later in Fileclass./);
  assert.equal(row(f.app, 'optional'), undefined);
  input(f.app, 'Input', 'hello'); input(f.app, 'Number', '0'); input(f.app, 'Boolean', 'false'); input(f.app, 'Date', '2026-10-13');
  for (const type of ['Select', 'Cycle', 'File']) input(f.app, type, '0');
  for (const type of ['MultiFile', 'Multi']) check(f.app, type, 'Shown label');
  input(f.app, 'MultiInput', 'one\n two\n\n');
  await save(f.app); await pending;
  assert.equal(f.state.values.get('Number'), 0); assert.equal(f.state.values.get('Boolean'), false);
  assert.deepEqual(f.state.values.get('MultiInput'), ['one', 'two']);
  assert.equal(f.state.values.get('File'), '[[Folder/Note#Heading|Alias]]');
  assert.deepEqual(f.state.values.get('MultiFile'), ['[[Folder/Note#Heading|Alias]]']);
  assert.deepEqual(f.state.values.get('optional'), ['unchanged']); assert.equal(f.app.closed, 1);
  assert.equal(f.state.writes.length, types.length); assert.ok(f.state.writes.every(write => write.signal instanceof AbortSignal));
});
test('empty unconstrained Select/Cycle allow text; Multi allows lines; file types never allow free text', async () => {
  const f = fixture(['Select', 'Cycle', 'Multi', 'File', 'MultiFile'].map(type => field(type, type)));
  const pending = f.start(); await tick();
  assert.equal(controls(f.app, 'File').length, 0); assert.equal(controls(f.app, 'MultiFile').length, 0);
  assert.match(text(f.app), /No candidate files/);
  input(f.app, 'Select', 'free'); input(f.app, 'Cycle', 'free'); input(f.app, 'Multi', 'a\nb');
  await save(f.app); assert.deepEqual(f.state.writes.map(write => write.field.name), ['Select', 'Cycle', 'Multi']);
  assert.equal(f.app.closed, 0); f.app.dialog.close(); await pending;
});
test('incomplete and unsupported required fields remain explicit, read-only, and uncoerced', async () => {
  const f = fixture([field('missing'), field('object', 'Object'), field('formula', 'Input', { supported: false, issue: 'Computed value' })]);
  const pending = f.start(); await tick();
  assert.equal(controls(f.app, 'object').length, 0); assert.equal(controls(f.app, 'formula').length, 0);
  assert.match(text(f.app), /Object is read-only here.*Use Fileclass/); assert.match(text(f.app), /Computed value/);
  await save(f.app); assert.equal(f.state.writes.length, 0); assert.match(text(f.app), /A value is required/);
  assert.equal(f.app.closed, 0); f.app.dialog.close(); await pending;
});
test('number/Boolean validation stays local; Fileclass Date errors stay field-local', async () => {
  const f = fixture([field('number', 'Number'), field('date', 'Date'), field('bool', 'Boolean')]), delegated = [];
  f.backend.setValue = async (_path, field, value) => { delegated.push([field.name, value]); throw Error('Fileclass: invalid date for configured format'); };
  const pending = f.start(); await tick();
  assert.deepEqual(controls(f.app, 'bool')[0].control.options, { '': 'Not set', true: 'True', false: 'False' });
  input(f.app, 'number', 'Infinity'); input(f.app, 'date', '2026-02-30'); await save(f.app);
  assert.deepEqual(delegated, [['date', '2026-02-30']]);
  assert.equal(f.state.writes.length, 0); assert.match(text(f.app), /finite number/); assert.match(text(f.app), /Fileclass: invalid date/); assert.match(text(f.app), /Choose true or false/);
  f.app.dialog.close(); await pending;
});
test('partial successes are recorded; backend target/metadata errors stay inline and retry only unresolved fields', async () => {
  const f = fixture([field('A'), field('B')]); const write = f.backend.setValue; let fail = true;
  f.backend.setValue = async (...args) => { if (args[1].name === 'B' && fail) throw Error('Target metadata changed; try again'); await write(...args); };
  const pending = f.start(); await tick(); input(f.app, 'A', 'saved'); input(f.app, 'B', 'retry'); await save(f.app);
  assert.equal(row(f.app, 'A'), undefined); assert.match(text(f.app), /Saved: A/); assert.match(text(f.app), /Target metadata changed/);
  fail = false; await save(f.app); await pending; assert.deepEqual(f.state.writes.map(write => write.field.name), ['A', 'B']);
});
test('a successful write is not assumed to satisfy Fileclass requiredness', async () => {
  const f = fixture([field('A')]); f.backend.setValue = async () => {};
  const pending = f.start(); await tick(); input(f.app, 'A', 'value'); await save(f.app);
  assert.match(text(f.app), /Saved: A/); assert.match(text(f.app), /still reports this required field as incomplete/);
  f.app.dialog.close(); await pending;
});
test('concurrently filled fields are skipped, including a fill while choices are pending', async () => {
  const f = fixture([field('A'), field('B', 'Select')]); f.state.choices.B = [{ value: 'old', label: 'Old' }];
  const pending = f.start(); await tick(); input(f.app, 'A', 'draft'); input(f.app, 'B', '0');
  f.state.values.set('A', 'external'); const waiting = deferred(); f.backend.choices = () => waiting.promise;
  const saving = save(f.app); await tick(); f.state.values.set('B', 'external'); waiting.resolve(f.state.choices.B);
  await saving; await pending; assert.equal(f.state.writes.length, 0); assert.equal(f.state.values.get('A'), 'external');
});
for (const change of ['owner', 'type', 'options', 'supported']) test(`changed ${change} snapshot blocks a stale write`, async () => {
  const f = fixture([field('A')]); const pending = f.start(); await tick(); input(f.app, 'A', 'draft');
  if (change === 'options') { f.state.fields[0].options.nested = { changed: true }; f.state.issued[0][0].options.nested = { changed: true }; }
  else f.state.fields[0][change] = change === 'supported' ? false : change === 'type' ? 'Number' : 'Other';
  await save(f.app); assert.equal(f.state.writes.length, 0); assert.match(text(f.app), /definition changed|read-only/);
  f.app.dialog.close(); await pending;
});
test('dependent choices refresh after saving A, reject stale B, and retain B draft without writing it', async () => {
  const f = fixture([field('A'), field('B', 'Select')]);
  f.backend.choices = async (_path, field) => { f.state.events.push(['choices', field.name]); return [{ value: f.state.values.has('A') ? 'new' : 'old', label: 'Choice' }]; };
  const pending = f.start(); await tick(); input(f.app, 'A', 'changed'); input(f.app, 'B', '0'); await save(f.app);
  assert.deepEqual(f.state.writes.map(write => write.field.name), ['A']); assert.match(text(f.app), /no longer available/);
  const writeIndex = f.state.events.findIndex(event => event[0] === 'write');
  assert.ok(f.state.events.slice(writeIndex + 1).some(event => event[0] === 'choices' && event[1] === 'B'));
  input(f.app, 'B', '0'); await save(f.app); await pending; assert.equal(f.state.values.get('B'), 'new');
});
test('stale multi-choices stay visible until explicitly removed, without losing other selections', async () => {
  const f = fixture([field('A'), field('B', 'Multi')]);
  f.backend.choices = async () => f.state.values.has('A') ? [{ value: 'keep', label: 'Keep' }, { value: 'new', label: 'New' }]
    : [{ value: 'keep', label: 'Keep' }, { value: 'old', label: 'Old' }];
  const pending = f.start(); await tick(); input(f.app, 'A', 'change'); check(f.app, 'B', 'Keep'); check(f.app, 'B', 'Old');
  await save(f.app); assert.match(text(f.app), /old \(no longer available\)/); assert.equal(f.state.values.has('B'), false);
  const stale = controls(f.app, 'B').find(el => el.attrs['aria-label'] === 'old (no longer available)');
  stale.checked = false; stale.listeners.change(); check(f.app, 'B', 'New'); await save(f.app); await pending;
  assert.deepEqual(f.state.values.get('B'), ['keep', 'new']);
});
test('colliding unsupported nested names remain visible instead of silently dropping a required row', async () => {
  const f = fixture([field('name'), field('name', 'Input', { supported: false, issue: 'Required nested field object.name' })]);
  const pending = f.start(); await tick(); input(f.app, 'name', 'root'); await save(f.app);
  assert.match(text(f.app), /Required nested field object.name/); assert.match(text(f.app), /Ambiguous required field name/);
  assert.equal(f.state.writes.length, 0); f.app.dialog.close(); await pending;
});
for (const cancel of ['signal', 'button', 'close']) test(`${cancel} during a write settles once, aborts work, and disables late callbacks`, async () => {
  const f = fixture([field('A'), field('B')]); const controller = new AbortController(), waiting = deferred();
  const write = f.backend.setValue; let writeSignal;
  f.backend.setValue = async (...args) => { writeSignal = args[3]; await waiting.promise; await write(...args); };
  let settled = 0; const pending = f.start(controller.signal).then(() => { settled++; }); await tick();
  const late = input(f.app, 'A', 'kept'); input(f.app, 'B', 'never'); const lateSave = button(f.app, 'Save required values');
  const saving = save(f.app); await tick(); assert.ok(writeSignal);
  if (cancel === 'signal') controller.abort(); else if (cancel === 'button') button(f.app, 'Close').click(); else f.app.dialog.close();
  await pending; assert.equal(writeSignal.aborted, true); const reads = f.state.events.length;
  late.control.change('late'); await lateSave.click(); waiting.resolve(); await saving;
  assert.equal(settled, 1); assert.equal(f.app.closed, 1); assert.equal(f.state.values.get('A'), 'kept');
  assert.equal(f.state.values.has('B'), false); assert.equal(f.state.events.length, reads + 1);
});
for (const stage of ['required', 'choices', 'prewrite']) test(`abort during ${stage} lookup has no follow-up work`, async () => {
  const f = fixture([field('A', 'Select')]); const waiting = deferred(), controller = new AbortController();
  if (stage === 'required') f.backend.requiredFields = () => waiting.promise;
  if (stage === 'choices') f.backend.choices = () => waiting.promise;
  const pending = f.start(controller.signal); await tick();
  let saving; if (stage === 'prewrite') { input(f.app, 'A', 'value'); f.backend.requiredFields = () => waiting.promise; saving = save(f.app); }
  controller.abort(); await pending; waiting.resolve(stage === 'choices' ? [] : [field('A')]); await saving; await tick();
  assert.equal(f.state.writes.length, 0); assert.equal(f.app.opened, stage === 'required' ? 0 : 1);
});
for (const mode of ['changed', 'throws']) test(`backend token ${mode} during an await blocks writes and closes the session`, async () => {
  const f = fixture([field('A')]); const pending = f.start(); await tick(); input(f.app, 'A', 'value');
  const waiting = deferred(); f.backend.requiredFields = () => waiting.promise; const saving = save(f.app);
  if (mode === 'changed') f.state.token = {}; else f.backend.token = () => { throw Error('Fileclass unloaded'); };
  waiting.resolve(f.state.fields); await saving; await pending; assert.equal(f.state.writes.length, 0); assert.equal(f.app.closed, 1);
});
test('choice lookup failures are explicit, never turn into unrestricted inputs', async () => {
  const f = fixture([field('A', 'Select')]); f.backend.choices = async () => { throw Error('Bad choice query'); };
  const pending = f.start(); await tick(); assert.equal(controls(f.app, 'A').length, 0); assert.match(text(f.app), /Bad choice query/);
  await save(f.app); assert.equal(f.state.writes.length, 0); f.app.dialog.close(); await pending;
});
test('both Ctrl/Meta Enter use the save path, and repeated submissions cannot duplicate writes', async () => {
  const f = fixture([field('A')]); const pending = f.start(); await tick(); input(f.app, 'A', 'value');
  assert.deepEqual(f.app.dialog.keys.map(key => key.slice(0, 2)), [[['Ctrl'], 'Enter'], [['Meta'], 'Enter']]);
  for (const key of f.app.dialog.keys) assert.equal(key[2](), false);
  await pending; assert.equal(f.state.writes.length, 1);
});
test('choices and writes retain the original issued identity through fresh checks and refresh/retry', async () => {
  const f = fixture([field('A', 'Select')]); const pending = f.start(); await tick();
  const original = f.state.issued[0][0], write = f.backend.setValue; let attempts = 0;
  f.backend.setValue = async (...args) => { assert.equal(args[1], original); if (!attempts++) throw Error('Retry'); await write(...args); };
  input(f.app, 'A', 'draft'); await save(f.app);
  assert.ok(f.state.issued.length > 2); assert.notEqual(f.state.issued[1][0], original);
  await save(f.app); await pending;
  assert.ok(f.state.choiceRequests.length >= 4); assert.ok(f.state.choiceRequests.every(request => request === original));
  assert.equal(f.state.writes[0].field, original);
});
test('an initially missing or non-file target rejects before requesting metadata', async () => {
  for (const target of [null, { path: 'Nodes/New.md' }]) {
    const f = fixture(); f.state.target = target; await assert.rejects(f.start(), /note is unavailable/);
    assert.equal(f.app.opened, 0); assert.deepEqual(f.state.events, []);
  }
});
for (const mode of ['deleted', 'replaced', 'renamed']) for (const stage of ['required', 'choices', 'prewrite', 'idle']) {
  test(`target ${mode} during ${stage} cannot rebind or write to another file`, async () => {
    const f = fixture([field('A', 'Select')]), waiting = deferred();
    if (stage === 'required') f.backend.requiredFields = () => waiting.promise;
    if (stage === 'choices') f.backend.choices = () => waiting.promise;
    const pending = f.start(); await tick(); let saving;
    if (stage === 'prewrite' || stage === 'idle') input(f.app, 'A', 'draft');
    if (stage === 'prewrite') { f.backend.requiredFields = () => waiting.promise; saving = save(f.app); }
    if (mode === 'deleted') f.state.target = null;
    else if (mode === 'replaced') f.state.target = new TFile('Nodes/New.md');
    else { f.state.target.path = 'Nodes/Renamed.md'; f.app.vault.getAbstractFileByPath = () => f.state.target; }
    if (stage === 'idle') await save(f.app);
    waiting.resolve(stage === 'choices' ? [] : f.state.fields); await saving; await pending; await tick();
    assert.equal(f.state.writes.length, 0); assert.equal(f.app.opened, stage === 'required' ? 0 : 1);
    assert.equal(f.app.closed, f.app.opened); assert.match(globalThis.requiredNotices.at(-1), /deleted, replaced, or renamed.*saved fields are kept/);
  });
}
for (const mode of ['empty', 'cancel', 'error']) test(`signal listeners cleaned after ${mode}`, async () => {
  const controller = new AbortController(); const signal = controller.signal; let handlers = 0;
  const add = signal.addEventListener.bind(signal), remove = signal.removeEventListener.bind(signal);
  signal.addEventListener = (...args) => { handlers++; return add(...args); }; signal.removeEventListener = (...args) => { handlers--; return remove(...args); };
  const f = fixture(mode === 'cancel' ? [field('A')] : []);
  if (mode === 'error') f.backend.requiredFields = async () => { throw Error('Missing target note'); };
  const pending = f.start(signal);
  if (mode === 'error') await assert.rejects(pending, /Missing target note/);
  else { await tick(); if (mode === 'cancel') f.app.dialog.close(); await pending; }
  assert.equal(handlers, 0);
});
