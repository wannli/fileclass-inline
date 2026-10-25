import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, tick, deferred, createTypedNote, notices, TFile, Platform, iconCalls } from './capture-fixture.mjs';
import { devices, expectSuggestionStyle, expectClassIcon, pointerDocument } from './suggestion-test-helpers.mjs';

const inline = { type: 'person', suggestedTitle: 'Ada', inline: true };

for (const device of devices) test(`class picker uses aligned Fileclass icons and correct spacing on ${device.name}`, async t => {
  const f = fixture(), mobile = Platform.isMobile;
  Platform.isMobile = device.mobile; iconCalls.length = 0;
  t.after(() => { f.api.dispose(); Platform.isMobile = mobile; });
  f.state.types.push({ name: 'No icon' });
  const pending = f.api.createNode({ suggestedTitle: 'Ada' }); await tick();
  const picker = f.app.dialog, items = picker.getSuggestions(''), rendered = [];
  assert.deepEqual(items.map(item => item.name), ['person', 'author', 'No icon']);
  assert.deepEqual(picker.getSuggestions('PER').map(item => item.name), ['person']);
  for (const item of items) {
    const el = picker.contentEl.createSpan(); el.ownerDocument = pointerDocument(device.coarse);
    picker.renderSuggestion(item, el); rendered.push(el);
    expectSuggestionStyle(el, device);
    assert.equal(el.textContent, item.name, 'the icon must not replace, prefix or duplicate the class label');
    assert.equal(el.children.length, item.icon ? 2 : 1);
  }
  assert.deepEqual(iconCalls.map(call => call.icon), ['user-round', 'notebook-pen']);
  for (const [i, call] of iconCalls.entries()) {
    assert.equal(call.el, rendered[i].children[0]);
    expectClassIcon(call.el);
  }
  assert.equal(f.counts.writes, 0); assert.equal(f.counts.required, 0);
  picker.close(); assert.equal(await pending, null);
});

test('real type picker close-before-onChooseSuggestion continues to the name prompt', async () => {
  const f = fixture();
  const pending = f.api.createNode({ suggestedTitle: 'Ada' }); await tick();
  const picker = f.app.dialog;
  assert.deepEqual(picker.getSuggestions('PER').map(item => item.name), ['person']);
  picker.close(); picker.onChooseSuggestion(picker.getSuggestions('person')[0]); await tick();
  assert.notEqual(f.app.dialog, picker);
  assert.equal(f.app.dialog.inputs[0].value, 'Ada');
  assert.equal(f.counts.writes, 0);
  f.submit(); assert.equal((await pending).path, 'Nodes/Ada.md');
});

test('one available class skips the picker while API creation still confirms the name', async () => {
  const f = fixture(); f.state.types = [f.state.types[0]];
  const pending = f.api.createNode({ suggestedTitle: 'Ada' }); await tick();
  assert.equal(f.app.dialogs.length, 1); assert.equal(f.app.dialog.inputs[0].value, 'Ada');
  assert.equal(f.app.dialog.getSuggestions, undefined);
  f.submit(); assert.equal((await pending).type, 'person');
  assert.equal(f.app.dialogs.length, 1);
});

test('one available class plus a valid inline title requires no prompts', async () => {
  const f = fixture(); f.state.types = [f.state.types[0]];
  const result = await f.capture.run({ suggestedTitle: 'Ada', inline: true });
  assert.equal(result.type.name, 'person'); assert.equal(result.file.path, 'Nodes/Ada.md');
  assert.equal(f.app.dialogs.length, 0); assert.equal(f.counts.writes, 1);
});

for (const type of [undefined, 'person']) test(`closing the ${type ? 'name' : 'type'} prompt cancels without a write`, async () => {
  const f = fixture();
  const pending = f.api.createNode({ type, suggestedTitle: 'Ada' }); await tick();
  f.app.dialog.close(); assert.equal(await pending, null);
  assert.equal(f.counts.writes, 0); assert.equal(f.counts.folders, 0);
});

for (const type of [undefined, 'person']) test(`abort closes the ${type ? 'name' : 'type'} prompt and rejects late selection`, async () => {
  const f = fixture(), controller = new AbortController();
  const pending = f.api.createNode({ type, suggestedTitle: 'Ada', signal: controller.signal }); await tick();
  const dialog = f.app.dialog; controller.abort();
  assert.equal(await pending, null); assert.equal(dialog.closed, true);
  if (type) f.submit(); else dialog.onChooseSuggestion(f.state.types[0]);
  await tick();
  assert.equal(f.counts.writes, 0); assert.equal(f.app.dialogs.length, 1);
});

test('invalid titles remain editable verbatim and are blocked, never auto-sanitized', async () => {
  for (const title of ['../Ada', 'Ada/Grace', 'Ada\nLovelace', ' Ada', 'Ada.', '', 'a:b', '\0bad']) {
    const f = fixture();
    const pending = f.capture.run({ ...inline, suggestedTitle: title }); await tick();
    assert.equal(f.app.dialog.inputs[0].value, title);
    f.submit(); await tick();
    assert.equal(f.app.dialog.closed, undefined);
    assert.ok(f.app.dialog.contentEl.children.some(el => el.attributes.role === 'alert' && el.text));
    assert.equal(f.counts.writes, 0);
    f.app.dialog.close(); assert.equal(await pending, null);
    await assert.rejects(createTypedNote(f.app, f.backend, f.settings, 'person', title));
    assert.equal(f.counts.writes, 0);
  }
});

test('an already aborted request cannot open prompts, load types, or write', async () => {
  const f = fixture(), signal = AbortSignal.abort();
  assert.equal(await f.capture.run({ ...inline, signal }), null);
  assert.equal(await f.api.createNode({ signal }), null);
  assert.equal(f.counts.types, 0); assert.equal(f.counts.writes, 0); assert.equal(f.app.dialogs.length, 0);
});

for (const stage of ['types', 'folder', 'classes', 'write']) for (const cancel of ['abort', 'dispose']) {
  test(`${cancel} during ${stage} settles promptly and prevents all subsequent writes or callbacks`, async () => {
    const f = fixture(), gate = deferred(), controller = new AbortController();
    f.hooks[stage] = () => gate.promise;
    let callbacks = 0;
    const pending = f.capture.run({ ...inline, signal: controller.signal }, () => { callbacks++; });
    await tick();
    if (cancel === 'abort') controller.abort(); else f.capture.dispose();
    assert.equal(await pending, null);
    gate.resolve(stage === 'types' ? f.state.types : stage === 'classes' ? ['person'] : undefined);
    await tick();
    const startedWrite = stage === 'classes' || stage === 'write';
    assert.equal(f.counts.writes, startedWrite ? 1 : 0);
    assert.equal(f.files.has('Nodes/Ada.md'), startedWrite); // Never prune an in-flight successful write.
    assert.equal(callbacks, 0); assert.equal(f.counts.required, 0);
    assert.equal(f.counts.forbidden, 0); assert.equal(f.index.all().length, 0);
    if (cancel === 'dispose') assert.equal(await f.capture.run({ ...inline, suggestedTitle: 'Later' }), null);
  });
}

test('cancelAll invalidates pending work but permits a fresh capture', async () => {
  const f = fixture(), gate = deferred();
  f.hooks.types = () => gate.promise;
  const pending = f.capture.run(inline); await tick();
  f.capture.cancelAll(); assert.equal(await pending, null);
  delete f.hooks.types; gate.resolve(f.state.types); await tick();
  assert.equal(f.counts.writes, 0);
  assert.equal((await f.capture.run(inline)).file.path, 'Nodes/Ada.md');
});

for (const change of ['token', 'settings', 'class removed']) test(`${change} while the name prompt is open prevents creation`, async () => {
  const f = fixture();
  const pending = f.api.createNode({ type: 'person', suggestedTitle: 'Ada' }); await tick();
  if (change === 'token') f.state.token = {};
  if (change === 'settings') f.settings.nodesFolder = 'Changed';
  if (change === 'class removed') f.state.types = [];
  f.submit(); assert.equal(await pending, null);
  assert.equal(f.counts.writes, 0);
});

test('binding mismatch times out closed, retains the note, and never remembers or links it', async t => {
  const f = fixture(); let clock = 0, callbacks = 0;
  t.mock.method(Date, 'now', () => (clock += 3000));
  f.hooks.classes = async () => ['different'];
  assert.equal(await f.capture.run(inline, () => { callbacks++; }), null);
  assert.ok(f.files.has('Nodes/Ada.md'));
  assert.equal(callbacks, 0); assert.equal(f.counts.required, 0); assert.equal(f.index.all().length, 0);
  assert.match(notices.at(-1), /not recognized.*kept/i);
});

test('replacement of the created file during binding prevents callbacks and indexing', async () => {
  const f = fixture();
  f.hooks.classes = async path => { f.files.set(path, new TFile(path)); return ['person']; };
  assert.equal(await f.capture.run(inline, () => assert.fail('Unexpected callback')), null);
  assert.equal(f.counts.required, 0); assert.equal(f.index.all().length, 0);
  assert.ok(f.files.has('Nodes/Ada.md'));
});

test('existing and racing filename collisions never overwrite or rename a note', async () => {
  for (const race of [false, true]) {
    const f = fixture();
    if (race) f.hooks.folder = () => { f.add('Nodes/Ada.md', 'authored content'); };
    else f.add('Nodes/Ada.md', 'authored content');
    if (race) assert.equal(await f.capture.run(inline), null);
    else await assert.rejects(createTypedNote(f.app, f.backend, f.settings, 'person', 'Ada'), /already exists/);
    assert.equal(f.contents.get('Nodes/Ada.md'), 'authored content');
    assert.equal(f.counts.writes, 0);
    assert.deepEqual([...f.contents.keys()], ['Nodes/Ada.md']);
  }
});

test('a racing Vault.create rejection is surfaced without modifying the competing file', async () => {
  const f = fixture();
  f.hooks.write = path => { f.add(path, 'winner'); };
  assert.equal(await f.capture.run(inline), null);
  assert.equal(f.contents.get('Nodes/Ada.md'), 'winner');
  assert.equal(f.counts.required, 0); assert.equal(f.index.all().length, 0);
});

test('full selected body is in the actual created file before callback, and false skips completion', async () => {
  const f = fixture(), body = 'Full selected text\nwith [[a link|label]] and existing formatting.\nLast line';
  let callbacks = 0;
  const result = await f.capture.run({ ...inline, body }, record => {
    callbacks++;
    assert.ok(f.contents.get(record.file.path).includes(body));
    assert.equal(f.index.all()[0].file, record.file);
    assert.equal(f.counts.required, 0);
    return false; // Caller found that the source editor changed.
  });
  assert.equal(result.file.path, 'Nodes/Ada.md'); assert.equal(callbacks, 1);
  assert.equal(f.counts.required, 0);
  assert.ok(f.contents.get(result.file.path).endsWith(`${body}\n`));
});

test('creation hooks that remove copied source text cannot trigger source replacement', async () => {
  const f = fixture();
  f.hooks.created = file => f.contents.set(file.path, 'External hook replaced content');
  assert.equal(await f.capture.run({ ...inline, body: 'Full selection\nSecond line' }, () => assert.fail('Source must remain intact')), null);
  assert.equal(f.contents.get('Nodes/Ada.md'), 'External hook replaced content');
  assert.equal(f.index.all().length, 0); assert.equal(f.counts.required, 0);
});


test('embedded linked creation reuses the title without opening a prompt', async () => {
  const f = fixture();
  f.add('Source.md');
  assert.equal(f.api.embeddedCreation, true);
  let linked = false;
  const node = await f.api.createNodeForLink({ type: 'person', suggestedTitle: 'Ada', sourcePath: 'Source.md', completionContainer: {} }, async () => { linked = true; });
  assert.equal(node.path, 'Nodes/Ada.md');
  assert.equal(linked, true);
  assert.equal(f.app.dialogs.length, 0);
});

test('embedded creation rejects missing classes and invalid titles without another modal', async () => {
  for (const options of [{ suggestedTitle: 'Ada' }, { type: 'person', suggestedTitle: '../Ada' }]) {
    const f = fixture();
    f.add('Source.md');
    assert.equal(await f.api.createNodeForLink({ ...options, sourcePath: 'Source.md', completionContainer: {} }, async () => assert.fail('No link expected')), null);
    assert.equal(f.counts.writes, 0);
    assert.equal(f.app.dialogs.length, 0);
  }
});
