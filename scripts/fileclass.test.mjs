import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { setTimeout as delay } from 'node:timers/promises';

const { outputFiles } = await build({ stdin: { contents: `
  export { FileclassBridge } from './src/fileclass';
  export { MetadataPendingError } from './src/fileclass-contract';
`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'host', setup(build) {
    build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'host' }));
    build.onLoad({ filter: /.*/, namespace: 'host' }, () => ({ contents: `
      export class App {}
      export class TFile { constructor(path) { this.path = path; this.extension = 'md'; } }
      globalThis.FileclassTestTFile = TFile;
    ` }));
  } }],
});
const { FileclassBridge, MetadataPendingError } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`);
const TFile = globalThis.FileclassTestTFile;
delete globalThis.FileclassTestTFile;
const path = 'Notes/task.md';
const def = (name = 'title', type = 'Input', options = { required: true }, extra = {}) =>
  ({ name, id: `id-${name}`, type, options, path: '', owner: 'Task', ...extra });

function fixture(definitions = [def()]) {
  const state = { definitions, values: {}, classes: [{ name: 'Task', icon: 'check-check' }], notes: {},
    explanation: { fileClasses: ['Task'] }, allowed: ['one', 'two'], candidates: [{ display: 'Ada', link: '[[People/Ada|Ada]]' }] };
  const calls = [];
  const implementations = {
    listFileClasses: () => state.classes,
    getSchema: owner => ({ name: owner, ancestors: [], options: {}, fields: state.definitions.filter(field => field.owner === owner) }),
    getFields: () => state.definitions.map(({ name, type, owner, path }) => ({ name, type, owner, path, isRoot: path === '' })),
    getValue: (_path, name) => state.values[name],
    allowedValues: () => state.allowed,
    fileCandidates: () => state.candidates,
    listNotes: name => state.notes[name] ?? [],
    explain: path => state.explanations ? state.explanations[path] ?? null : state.explanation,
    setValue: (_path, name, value) => {
      if (!state.deferVisibility) state.values[name] = value;
      return { ok: true };
    },
  };
  const api = { version: '1.1' };
  for (const [name, implementation] of Object.entries(implementations)) api[name] = async function (...args) {
    assert.equal(this, api, 'public API methods keep their receiver');
    calls.push([name, ...args]);
    return implementation(...args);
  };
  const plugin = { api };
  Object.defineProperty(plugin, 'settings', { get() { throw Error('private settings accessed'); } });
  Object.defineProperty(plugin, 'index', { get() { throw Error('private index accessed'); } });
  const files = new Map([[path, new TFile(path)]]);
  let enumerations = 0;
  const app = { plugins: { plugins: { fileclass: plugin } }, vault: {
    getAbstractFileByPath: path => files.get(path) ?? null,
    getMarkdownFiles: () => { enumerations++; return [...files.values()].filter(file => file instanceof TFile); },
  } };
  Object.defineProperty(app, 'metadataCache', { get() { throw Error('class note metadata must not be read'); } });
  const bridge = new FileclassBridge(app);
  return { state, calls, api, app, bridge, files, enumerations: () => enumerations,
    writes: () => calls.filter(([method]) => method === 'setValue') };
}
const requested = async fixture => (await fixture.bridge.requiredFields(path))[0];

function pause(api, method) {
  let entered, finish;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { finish = resolve; });
  const original = api[method];
  api[method] = async function (...args) {
    const result = await original.apply(this, args);
    entered();
    await gate;
    return result;
  };
  return { started, finish };
}

test('token is raw identity; absent, incompatible, and incomplete APIs fail actionably', async () => {
  const f = fixture();
  assert.equal(f.bridge.token(), f.api);
  assert.throws(() => new FileclassBridge({}).token(), /Enable Fileclass/);
  for (const version of ['2.0', '0.9', 1, undefined, '1garbage']) {
    f.api.version = version;
    assert.throws(() => f.bridge.token(), /API version/);
    await assert.rejects(f.bridge.types(), /API version/);
  }
  for (const version of ['1.1', '1.0.0', '1.12.3', '1.1.0-beta+build']) {
    f.api.version = version;
    assert.equal(f.bridge.token(), f.api);
  }
  for (const method of ['listFileClasses', 'getSchema', 'getFields', 'getValue', 'allowedValues', 'fileCandidates', 'explain', 'setValue']) {
    const original = f.api[method];
    f.api[method] = undefined;
    assert.throws(() => f.bridge.token(), /incomplete.*Update/);
    f.api[method] = original;
  }
  delete f.api.listNotes; // Bootstrap does not require this capability anymore.
  assert.equal(f.bridge.token(), f.api);
  const replacement = { ...f.api };
  f.app.plugins.plugins.fileclass.api = replacement;
  assert.equal(f.bridge.token(), replacement);
  assert.equal(new FileclassBridge({ plugins: { getPlugin: id => id === 'fileclass' ? { api: f.api } : null } }).token(), f.api);
});

test('types reads async public summaries and resolved icons only', async () => {
  const f = fixture();
  f.state.classes = [{ name: 'Child', extends: 'Parent', icon: 'inherited-icon', fieldCount: 2, hasBase: true },
    { name: 'Folder/Person', icon: 'user' }, { name: 'Plain', icon: '' }];
  const promise = f.bridge.types();
  assert.equal(typeof promise.then, 'function');
  assert.deepEqual(await promise, [{ name: 'Child', icon: 'inherited-icon' }, { name: 'Folder/Person', icon: 'user' }, { name: 'Plain' }]);
  assert.deepEqual(f.calls.map(([method]) => method), ['listFileClasses']);
});

test('members enumerates Markdown files once and explains each once without catalog or listNotes scans', async () => {
  const f = fixture();
  f.files.set('Other.md', new TFile('Other.md'));
  f.state.explanations = { [path]: { fileClasses: ['Task', 'Parent', 'Task'] }, 'Other.md': { fileClasses: ['Parent'] } };
  assert.deepEqual(await f.bridge.members(), [{ path, classes: ['Task', 'Parent'] }, { path: 'Other.md', classes: ['Parent'] }]);
  assert.equal(f.enumerations(), 1);
  assert.deepEqual(f.calls, [['explain', path], ['explain', 'Other.md']]);
});

test('members uses explained binding order rather than catalog order and drops unbound paths', async () => {
  const f = fixture();
  f.state.classes = [{ name: 'Alpha' }, { name: 'Zebra' }];
  f.files.set('Deleted.md', new TFile('Deleted.md'));
  f.files.set('Unbound.md', new TFile('Unbound.md'));
  f.state.explanations = { [path]: { fileClasses: ['Zebra', 'Alpha', 'Zebra'] }, 'Deleted.md': null,
    'Unbound.md': { fileClasses: [] } };
  assert.deepEqual(await f.bridge.members(), [{ path, classes: ['Zebra', 'Alpha'] }]);
  assert.deepEqual(f.calls.filter(([method]) => method === 'explain'),
    [['explain', path], ['explain', 'Deleted.md'], ['explain', 'Unbound.md']]);
});

test('bootstrap yields a real timer turn after forty files', async () => {
  const f = fixture();
  for (let i = 0; i < 80; i++) f.files.set(`${i}.md`, new TFile(`${i}.md`));
  let callsAtTimer;
  const turn = new Promise(resolve => setTimeout(() => {
    callsAtTimer = f.calls.filter(([method]) => method === 'explain').length;
    resolve();
  }, 0));
  const members = await f.bridge.members();
  await turn;
  assert.equal(callsAtTimer, 40, 'not just a resolved-Promise/microtask yield');
  assert.equal(members.length, 81);
  assert.equal(f.enumerations(), 1);
  assert.equal(f.calls.length, 81);
  assert.ok(f.calls.every(([method]) => method === 'explain'));
});

test('disconnect/reload in a bootstrap timer turn aborts before the next batch', async () => {
  for (const action of ['unload', 'reload']) {
    const f = fixture();
    for (let i = 0; i < 80; i++) f.files.set(`${i}.md`, new TFile(`${i}.md`));
    setTimeout(() => {
      if (action === 'unload') delete f.app.plugins.plugins.fileclass;
      else f.app.plugins.plugins.fileclass.api = { ...f.api };
    }, 0);
    await assert.rejects(f.bridge.members(), /unavailable|reloaded/);
    assert.equal(f.enumerations(), 1);
    assert.equal(f.calls.length, 40, 'no API calls from a subsequent batch');
  }
});

test('bootstrap signal aborts before scanning and between batches with the same Fileclass API', async () => {
  const f = fixture();
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(f.bridge.members(aborted.signal), /cancelled/);
  assert.equal(f.enumerations(), 0);
  assert.equal(f.calls.length, 0);
  for (let i = 0; i < 80; i++) f.files.set(`${i}.md`, new TFile(`${i}.md`));
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 0);
  await assert.rejects(f.bridge.members(controller.signal), /cancelled/);
  assert.equal(f.bridge.token(), f.api);
  assert.equal(f.enumerations(), 1);
  assert.equal(f.calls.length, 40);
  await delay(10);
  assert.equal(f.calls.length, 40, 'aborted bootstrap never starts the next batch');
});

test('bootstrap signal is checked after a pending explain, before any further file', async () => {
  const f = fixture();
  f.files.set('Next.md', new TFile('Next.md'));
  const gate = pause(f.api, 'explain');
  const controller = new AbortController();
  const pending = f.bridge.members(controller.signal);
  await gate.started;
  controller.abort();
  gate.finish();
  await assert.rejects(pending, /cancelled/);
  assert.equal(f.bridge.token(), f.api);
  assert.deepEqual(f.calls, [['explain', path]]);
});

test('bootstrap skips deleted, replaced, or renamed snapshot files before and after each explain', async () => {
  for (const action of ['delete', 'replace', 'rename']) {
    const f = fixture();
    f.files.set('Next.md', new TFile('Next.md'));
    const gate = pause(f.api, 'explain');
    const pending = f.bridge.members();
    await gate.started;
    for (const name of [path, 'Next.md']) {
      if (action === 'delete') f.files.delete(name);
      if (action === 'replace') f.files.set(name, new TFile(name));
      if (action === 'rename') f.files.get(name).path = `Renamed-${name}`;
    }
    f.files.set('Created-during-scan.md', new TFile('Created-during-scan.md'));
    gate.finish();
    assert.deepEqual(await pending, [], action);
    assert.equal(f.enumerations(), 1);
    assert.deepEqual(f.calls, [['explain', path]], action);
  }
});

test('bootstrap also drops an earlier member that vanishes while a later file is explained', async () => {
  const f = fixture();
  f.files.set('Next.md', new TFile('Next.md'));
  const original = f.api.explain;
  f.api.explain = async function (notePath) {
    if (notePath === 'Next.md') f.files.delete(path);
    return original.call(this, notePath);
  };
  assert.deepEqual(await f.bridge.members(), [{ path: 'Next.md', classes: ['Task'] }]);
});

test('bootstrap skips disappearance errors but does not hide errors for live files', async () => {
  const f = fixture();
  f.api.explain = async () => { throw Error('public read failed'); };
  await assert.rejects(f.bridge.members(), /public read failed/);
  f.api.explain = async () => { f.files.delete(path); throw Error('file disappeared'); };
  assert.deepEqual(await f.bridge.members(), []);
});

test('classesFor uses async explain only, with null and duplicate memberships normalized', async () => {
  const f = fixture();
  f.state.explanation = { fileClasses: ['Task', 'Parent', 'Task'], ancestry: [['Ignored']] };
  assert.deepEqual(await f.bridge.classesFor(path), ['Task', 'Parent']);
  f.state.explanation = null;
  assert.deepEqual(await f.bridge.classesFor('missing.md'), []);
  assert.deepEqual(f.calls.map(([method]) => method), ['explain', 'explain']);
});

test('required fields use effective owner schemas, exact root name/path, and strict required flags', async () => {
  const f = fixture([def('inherited', 'Input', { required: 'true' }, { owner: 'Parent' }),
    def('optional', 'Input', {}), def('false', 'Input', { required: 'false' }), def('truthy', 'Input', { required: 1 }),
    def('list-options', 'Select', ['one']), def('required')]);
  assert.deepEqual((await f.bridge.requiredFields(path)).map(field => [field.name, field.owner, field.supported]),
    [['inherited', 'Parent', true], ['required', 'Task', true]]);
  assert.deepEqual(f.calls.filter(([method]) => method === 'getSchema'), [['getSchema', 'Parent'], ['getSchema', 'Task']]);
  assert.deepEqual(f.calls.filter(([method]) => method === 'getValue').map(call => call[2]), ['inherited', 'required']);
  f.api.getSchema = async () => null;
  await assert.rejects(f.bridge.requiredFields(path), /schema.*unavailable/);
});

test('missing required is exactly null/undefined/blank/empty list: false and zero stay filled', async () => {
  const values = [undefined, null, '', '  \n ', [], false, 0, '0', [''], {}];
  const f = fixture(values.map((_, i) => def(`field${i}`)));
  values.forEach((value, i) => { f.state.values[`field${i}`] = value; });
  assert.deepEqual((await f.bridge.requiredFields(path)).map(field => field.name), ['field0', 'field1', 'field2', 'field3', 'field4']);
});

test('unsupported root required types report issues; optional or filled unsupported fields never prompt', async () => {
  const f = fixture([def('formula', 'Formula'), def('object', 'Object'), def('color', 'Color'),
    def('optional', 'Lookup', {}), def('filled', 'Object')]);
  f.state.values.filled = { name: 'already filled' };
  const fields = await f.bridge.requiredFields(path);
  assert.deepEqual(fields.map(field => field.name), ['formula', 'object', 'color']);
  assert.ok(fields.every(field => !field.supported && /unsupported type/.test(field.issue)));
  await assert.rejects(f.bridge.setValue(path, fields[0], 'value'), /unsupported/);
  assert.equal(f.writes().length, 0);
});

test('nested requirements inspect parent-ID paths, but absent optional parents deactivate them', async () => {
  const f = fixture([def('parent', 'Object', {}), def('title', 'Input', { required: true }, { path: 'id-parent' }),
    def('title', 'Input', {})]); // Same name at root must not borrow nested required options.
  for (const value of [undefined, null, '', []]) {
    f.state.values.parent = value;
    assert.deepEqual(await f.bridge.requiredFields(path), []);
  }
  f.state.values.parent = {};
  const [nested] = await f.bridge.requiredFields(path);
  assert.equal(nested.name, 'title');
  assert.equal(nested.supported, false);
  assert.match(nested.issue, /nested.*parent.title/);
  await assert.rejects(f.bridge.setValue(path, nested, 'wrong root'), /no longer/);
  f.state.values.parent = { title: false };
  assert.deepEqual(await f.bridge.requiredFields(path), []);
  assert.ok(f.calls.filter(([method]) => method === 'getValue').every(call => call[2] === 'parent'));
});

test('nested object lists and deeper optional containers do not silently lose required gaps', async () => {
  const f = fixture([def('items', 'ObjectList', {}), def('details', 'Object', {}, { path: 'id-items' }),
    def('name', 'Input', { required: true }, { path: 'id-items____id-details' })]);
  f.state.values.items = [{}, { details: { name: 'present' } }];
  assert.deepEqual(await f.bridge.requiredFields(path), []);
  f.state.values.items.push({ details: {} });
  const [gap] = await f.bridge.requiredFields(path);
  assert.equal(gap.supported, false);
  assert.match(gap.issue, /items.details.name/);
  f.state.definitions[1].options.required = true;
  f.state.values.items = [{}];
  assert.equal((await f.bridge.requiredFields(path)).length, 2);
  f.state.definitions = [def('orphan', 'Input', { required: true }, { path: 'unknown-id' })];
  assert.match((await f.bridge.requiredFields(path))[0].issue, /Cannot resolve parents/);
});

test('select choices use allowedValues; file choices preserve wiki and Markdown links verbatim', async () => {
  for (const type of ['Select', 'Cycle', 'Multi', 'File', 'MultiFile', 'Input']) {
    const f = fixture([def('field', type)]);
    f.state.candidates = [{ display: 'Ada', link: '[[People/Ada|Alias]]' }, { display: 'Project', link: '[Project](Projects/A%20B.md#Section)' }];
    const choices = await f.bridge.choices(path, await requested(f));
    assert.deepEqual(choices, ['File', 'MultiFile'].includes(type) ? f.state.candidates.map(({ display, link }) => ({ label: display, value: link })) :
      type === 'Input' ? [] : [{ label: 'one', value: 'one' }, { label: 'two', value: 'two' }]);
  }
});

test('all supported roots delegate values unchanged, including false, zero, and lists', async () => {
  const values = { Input: 'text', Number: 0, Boolean: false, Select: 'one', Cycle: 'two', Date: '2026-10-13',
    File: '[[People/Ada|Ada]]', MultiFile: ['[[People/Ada|Ada]]'], MultiInput: ['text'], Multi: ['one', 'two'] };
  for (const [type, value] of Object.entries(values)) {
    const f = fixture([def('field', type)]);
    const field = await requested(f);
    assert.equal(field.supported, true, type);
    await f.bridge.setValue(path, field, value);
    assert.deepEqual(f.writes(), [['setValue', path, 'field', value]]);
  }
});

test('setters reject blank required values and nonmembers before calling upstream', async () => {
  const f = fixture();
  const field = await requested(f);
  for (const value of [undefined, null, '', ' \t ', []]) await assert.rejects(f.bridge.setValue(path, field, value), /required/);
  assert.equal(f.writes().length, 0);
  for (const type of ['Select', 'Cycle', 'Multi', 'File', 'MultiFile']) {
    const f = fixture([def('field', type)]);
    const field = await requested(f);
    await assert.rejects(f.bridge.setValue(path, field, type.startsWith('Multi') ? ['unknown'] : 'unknown'), /allowed value/);
    assert.equal(f.writes().length, 0);
    f.state.allowed = [];
    f.state.candidates = [];
    const write = f.bridge.setValue(path, field, type.startsWith('Multi') ? ['unknown'] : 'unknown');
    if (['File', 'MultiFile'].includes(type)) {
      await assert.rejects(write, /allowed value/); // Empty candidate lists do not permit stale links.
      assert.equal(f.writes().length, 0);
    } else await write; // Unconstrained Select/Cycle/Multi: upstream decides validity.
  }
});

test('setters reject removed, optionalized, overridden, edited, replaced-id, or already filled definitions', async () => {
  for (const change of [
    state => { state.definitions = []; }, state => { state.definitions[0].options = {}; },
    state => { state.definitions[0].owner = 'Other'; }, state => { state.definitions[0].type = 'Date'; },
    state => { state.definitions[0].id = 'replacement'; }, state => { state.definitions[0].options = { required: true, max: 10 }; },
    state => { state.values.title = false; },
  ]) {
    const f = fixture();
    const field = await requested(f);
    change(f.state);
    await assert.rejects(f.bridge.setValue(path, field, 'new'), /Reopen the picker/);
    assert.equal(f.writes().length, 0);
  }
});

test('public setter failures and thrown errors are propagated, not converted to success', async () => {
  const f = fixture();
  const field = await requested(f);
  f.api.setValue = async () => ({ ok: false, message: 'Upstream validation rejected the value' });
  await assert.rejects(f.bridge.setValue(path, field, 'new'), /Upstream validation/);
  f.api.setValue = async () => ({ ok: false });
  await assert.rejects(f.bridge.setValue(path, field, 'new'), /could not save/);
  f.api.setValue = async () => { throw Error('disk write failed'); };
  await assert.rejects(f.bridge.setValue(path, field, 'new'), /disk write failed/);
});

test('all operations precheck availability, and reads reject a changed connection after awaits', async () => {
  const operations = [
    ['types', 'listFileClasses', (f) => f.bridge.types()],
    ['members', 'explain', (f) => f.bridge.members()],
    ['classesFor', 'explain', (f) => f.bridge.classesFor(path)],
    ['requiredFields', 'getFields', (f) => f.bridge.requiredFields(path)],
    ['requiredFields', 'getSchema', (f) => f.bridge.requiredFields(path)],
    ['requiredFields', 'getValue', (f) => f.bridge.requiredFields(path)],
    ['choices', 'allowedValues', (f, field) => f.bridge.choices(path, field)],
  ];
  for (const [name, method, run] of operations) {
    const f = fixture([def('field', 'Select')]);
    const field = await requested(f);
    const gate = pause(f.api, method);
    const pending = run(f, field);
    await gate.started;
    f.app.plugins.plugins.fileclass.api = { ...f.api };
    gate.finish();
    await assert.rejects(pending, /reloaded/, `${name}/${method}`);
    delete f.app.plugins.plugins.fileclass;
    await assert.rejects(run(f, field), /unavailable/);
  }
});

test('unload/reload or cancellation during preparation cannot dispatch an old-connection write', async () => {
  for (const method of ['getFields', 'getSchema', 'getValue', 'fileCandidates']) {
    for (const action of ['unload', 'reload', 'abort']) {
      const f = fixture([def('file', 'File')]);
      const field = await requested(f);
      const controller = new AbortController();
      const gate = pause(f.api, method);
      const pending = f.bridge.setValue(path, field, '[[People/Ada|Ada]]', controller.signal);
      await gate.started;
      if (action === 'abort') controller.abort();
      else if (action === 'unload') delete f.app.plugins.plugins.fileclass;
      else f.app.plugins.plugins.fileclass.api = { ...f.api };
      gate.finish();
      await assert.rejects(pending, /unavailable|reloaded|cancelled/);
      assert.equal(f.writes().length, 0, `${method}/${action}`);
    }
  }
});

test('candidate callbacks can cancel; definition/value changes during candidates are checked again', async () => {
  for (const change of ['abort', 'optional', 'filled', 'definition']) {
    const f = fixture([def('file', 'File')]);
    const field = await requested(f);
    const controller = new AbortController();
    f.api.fileCandidates = async () => {
      if (change === 'abort') controller.abort();
      if (change === 'optional') f.state.definitions[0].options.required = false;
      if (change === 'filled') f.state.values.file = '[[Someone else]]';
      if (change === 'definition') f.state.definitions[0].id = 'replacement';
      return f.state.candidates;
    };
    await assert.rejects(f.bridge.setValue(path, field, '[[People/Ada|Ada]]', controller.signal), /cancelled|Reopen/);
    assert.equal(f.writes().length, 0);
  }
  const f = fixture();
  const field = await requested(f);
  const controller = new AbortController();
  controller.abort();
  const calls = f.calls.length;
  await assert.rejects(f.bridge.setValue(path, field, 'text', controller.signal), /cancelled/);
  assert.equal(f.calls.length, calls);
  delete f.app.plugins.plugins.fileclass;
  await assert.rejects(f.bridge.setValue(path, field, 'text'), /unavailable/);
});

test('empty File/MultiFile candidates reject previously saved choices', async () => {
  for (const type of ['File', 'MultiFile']) {
    const f = fixture([def('file', type)]);
    const field = await requested(f);
    const [choice] = await f.bridge.choices(path, field);
    f.state.candidates = [];
    await assert.rejects(f.bridge.setValue(path, field, type === 'File' ? choice.value : [choice.value]), /allowed value/);
    assert.equal(f.writes().length, 0);
  }
});

test('required fields bind the original TFile and path, not a cloned or freshly replaced target', async () => {
  const f = fixture();
  const field = await requested(f);
  await assert.rejects(f.bridge.setValue(path, structuredClone(field), 'text'), /original required field/);
  await assert.rejects(f.bridge.choices(path, structuredClone(field)), /original required field/);
  await assert.rejects(f.bridge.setValue('Other.md', field, 'text'), /original required field/);
  f.files.set(path, new TFile(path));
  const fresh = await requested(f); // A later form can bind a new file; the old form remains invalid.
  await assert.rejects(f.bridge.setValue(path, field, 'text'), /deleted, replaced, or renamed/);
  await assert.rejects(f.bridge.choices(path, field), /deleted, replaced, or renamed/);
  assert.equal(f.writes().length, 0);
  await f.bridge.setValue(path, fresh, 'new form');
  assert.equal(f.writes().length, 1);
  f.files.set(path, { path, children: [] }); // Folders are not notes.
  await assert.rejects(f.bridge.requiredFields(path), /note is unavailable/);
  f.files.delete(path);
  await assert.rejects(f.bridge.requiredFields(path), /note is unavailable/);
});

test('requiredFields refuses a target replaced during any awaited read', async () => {
  for (const method of ['getFields', 'getSchema', 'getValue']) {
    const f = fixture();
    const gate = pause(f.api, method);
    const pending = f.bridge.requiredFields(path);
    await gate.started;
    f.files.set(path, new TFile(path));
    gate.finish();
    await assert.rejects(pending, /deleted, replaced, or renamed/);
  }
});

test('replacement, deletion, or rename during every preparation step prevents writes', async () => {
  for (const method of ['getFields', 'getSchema', 'getValue', 'fileCandidates']) {
    for (const action of ['replace', 'delete', 'rename']) {
      const f = fixture([def('file', 'File')]);
      const field = await requested(f);
      const gate = pause(f.api, method);
      const pending = f.bridge.setValue(path, field, '[[People/Ada|Ada]]');
      await gate.started;
      if (action === 'replace') f.files.set(path, new TFile(path));
      if (action === 'delete') f.files.delete(path);
      if (action === 'rename') f.files.get(path).path = 'Renamed.md'; // Even a stale lookup must fail the path check.
      const calls = f.calls.length;
      gate.finish();
      await assert.rejects(pending, /deleted, replaced, or renamed/);
      assert.equal(f.calls.length, calls, `${method}/${action}: no further API calls`);
      assert.equal(f.writes().length, 0, `${method}/${action}`);
    }
  }
});

test('pending choice reads also reject replacement of the bound file', async () => {
  const f = fixture([def('file', 'File')]);
  const field = await requested(f);
  const gate = pause(f.api, 'fileCandidates');
  const pending = f.bridge.choices(path, field);
  await gate.started;
  f.files.set(path, new TFile(path));
  gate.finish();
  await assert.rejects(pending, /deleted, replaced, or renamed/);
  assert.equal(f.writes().length, 0);
});

test('successful writes wait for public metadata visibility, accepting false, zero, or another editor’s value', async () => {
  for (const visible of [false, 0, 'concurrent edit']) {
    const f = fixture();
    f.state.deferVisibility = true;
    f.state.values.title = [];
    const field = await requested(f);
    let readAfterWrite;
    const polled = new Promise(resolve => { readAfterWrite = resolve; });
    const original = f.api.getValue;
    f.api.getValue = async function (...args) {
      const value = await original.apply(this, args);
      if (f.writes().length) readAfterWrite();
      return value;
    };
    let completed = false;
    const saving = f.bridge.setValue(path, field, 'submitted').then(() => { completed = true; });
    await polled;
    await delay(60);
    assert.equal(completed, false, 'empty metadata must not complete the save');
    assert.equal(f.writes().length, 1);
    f.state.values.title = visible;
    await saving;
    assert.deepEqual(await f.bridge.requiredFields(path), []);
    const count = f.calls.length;
    await delay(60);
    assert.equal(f.calls.length, count, 'visibility success clears its polling timer');
  }
});

test('abort, stale API, and changed note during visibility waiting stop polling without another write', async () => {
  for (const action of ['abort', 'reload', 'unload', 'replace', 'rename']) {
    const f = fixture();
    f.state.deferVisibility = true;
    const field = await requested(f);
    const controller = new AbortController();
    let readAfterWrite;
    const polled = new Promise(resolve => { readAfterWrite = resolve; });
    const original = f.api.getValue;
    f.api.getValue = async function (...args) {
      const value = await original.apply(this, args);
      if (f.writes().length) readAfterWrite();
      return value;
    };
    const saving = f.bridge.setValue(path, field, 'submitted', controller.signal);
    await polled;
    await delay(50); // Let the first missing read finish; cancel during polling rather than preparation.
    if (action === 'abort') controller.abort();
    if (action === 'reload') f.app.plugins.plugins.fileclass.api = { ...f.api };
    if (action === 'unload') delete f.app.plugins.plugins.fileclass;
    if (action === 'replace') f.files.set(path, new TFile(path));
    if (action === 'rename') f.files.get(path).path = 'Renamed.md';
    await assert.rejects(saving, /cancelled|reloaded|unavailable|renamed/);
    const count = f.calls.length;
    await delay(60);
    assert.equal(f.calls.length, count, action);
    assert.equal(f.writes().length, 1, action);
  }
});

test('metadata visibility has a bounded actionable timeout even if a public read stalls', async () => {
  await Promise.all([false, true].map(async stalled => {
    const f = fixture();
    f.state.deferVisibility = true;
    const field = await requested(f);
    const original = f.api.getValue;
    f.api.getValue = async function (...args) {
      const value = await original.apply(this, args);
      if (stalled && f.writes().length) return new Promise(() => {});
      return value;
    };
    const start = Date.now();
    await assert.rejects(f.bridge.setValue(path, field, 'submitted'), error => {
      assert.ok(error instanceof MetadataPendingError);
      assert.equal(error.writeSucceeded, true);
      assert.match(error.message, /Value saved.*metadata is not ready.*check the note in Fileclass.*do not submit again/);
      return true;
    });
    assert.ok(Date.now() - start >= 1500 && Date.now() - start < 2500, 'bounded metadata wait');
    assert.equal(f.writes().length, 1, 'never repeat a successful write');
    const count = f.calls.length;
    await delay(60);
    assert.equal(f.calls.length, count, 'timeout clears its polling timer');
  }));
});

test('retrying the original descriptor after metadata timeout only waits and never writes twice', async () => {
  const f = fixture();
  f.state.deferVisibility = true;
  const field = await requested(f);
  await assert.rejects(f.bridge.setValue(path, field, 'submitted'), MetadataPendingError);
  assert.equal(f.writes().length, 1);
  const calls = f.calls.length;
  let completed = false;
  const retry = f.bridge.setValue(path, field, 'changed draft must not overwrite').then(() => { completed = true; });
  await delay(60);
  assert.equal(completed, false);
  assert.equal(f.writes().length, 1);
  assert.ok(f.calls.slice(calls).every(([method]) => method === 'getValue'));
  f.state.values.title = 'concurrent editor filled it';
  await retry;
  await f.bridge.setValue(path, field, 'another retry');
  assert.deepEqual(f.writes(), [['setValue', path, 'title', 'submitted']]);
});

test('successful descriptors keep their original file and API guards on metadata-only retries', async () => {
  for (const change of ['api', 'file', 'rename', 'abort']) {
    const f = fixture();
    const field = await requested(f);
    await f.bridge.setValue(path, field, 'submitted');
    const calls = f.calls.length;
    const controller = new AbortController();
    if (change === 'api') f.app.plugins.plugins.fileclass.api = { ...f.api };
    if (change === 'file') f.files.set(path, new TFile(path));
    if (change === 'rename') f.files.get(path).path = 'Renamed.md';
    if (change === 'abort') controller.abort();
    await assert.rejects(f.bridge.setValue(path, field, 'retry', controller.signal), /reloaded|renamed|cancelled/);
    assert.equal(f.calls.length, calls);
    assert.equal(f.writes().length, 1);
  }
});

test('a successful raw write is remembered even when cancellation wins its acknowledgement guard', async () => {
  const f = fixture();
  const field = await requested(f);
  const controller = new AbortController();
  const gate = pause(f.api, 'setValue');
  const saving = f.bridge.setValue(path, field, 'submitted', controller.signal);
  await gate.started;
  controller.abort();
  gate.finish();
  await assert.rejects(saving, /cancelled/);
  await f.bridge.setValue(path, field, 'retry');
  assert.deepEqual(f.writes(), [['setValue', path, 'title', 'submitted']]);
});

test('abort interrupts even a stalled post-write read and cleans up its timer', async () => {
  const f = fixture();
  f.state.deferVisibility = true;
  const field = await requested(f);
  const controller = new AbortController();
  let readAfterWrite, release;
  const polled = new Promise(resolve => { readAfterWrite = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const original = f.api.getValue;
  f.api.getValue = async function (...args) {
    const value = await original.apply(this, args);
    if (f.writes().length) { readAfterWrite(); return gate; }
    return value;
  };
  const saving = f.bridge.setValue(path, field, 'submitted', controller.signal);
  await polled;
  controller.abort();
  await assert.rejects(saving, /cancelled/);
  release('late metadata');
  const count = f.calls.length;
  await delay(60);
  assert.equal(f.calls.length, count);
  assert.equal(f.writes().length, 1);
});

test('completion of an already dispatched public write still guards the connection', async () => {
  const f = fixture();
  const field = await requested(f);
  const gate = pause(f.api, 'setValue');
  const pending = f.bridge.setValue(path, field, 'text');
  await gate.started;
  delete f.app.plugins.plugins.fileclass;
  gate.finish();
  await assert.rejects(pending, /unavailable/);
  assert.equal(f.writes().length, 1); // The public API has no cancellation once it owns the write.
});
