import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MetadataPendingError, fixture, field, tick, text, controls, input, button, save } from './required-ui-fixture.mjs';

for (const action of ['retry', 'retry-wait', 'close']) test(`metadata-pending A stops the batch, retains drafts/writes, and allows ${action}`, async () => {
  const f = fixture([field('A'), field('B', 'Select')]);
  const target = f.state.target, disk = new Map(), choose = f.backend.choices, write = f.backend.setValue;
  let visible = false, rawAWrites = 0, aAttempts = 0;
  const choiceVisibility = [];
  f.backend.choices = async (...args) => {
    choiceVisibility.push(visible);
    f.state.choices.B = [{ value: 'kept', label: 'Keep this draft' }, { value: visible ? 'new' : 'old', label: 'Dependent option' }];
    return choose(...args);
  };
  f.backend.setValue = async (...args) => {
    const [, descriptor, value] = args;
    if (descriptor.name === 'A') {
      aAttempts++;
      assert.equal(descriptor, f.state.issued[0][0]);
      if (!disk.has('A')) { rawAWrites++; disk.set('A', value); }
      // Simulate the adapter's wait-only retry for an already dispatched write.
      if (!visible) throw new MetadataPendingError('Fileclass has not exposed the saved value yet.');
      f.state.values.set('A', disk.get('A')); return;
    }
    assert.equal(visible, true, 'B must not write against stale dependency metadata');
    disk.set('B', value); await write(...args);
  };
  const pending = f.start(); await tick();
  input(f.app, 'A', 'already on disk'); const draft = input(f.app, 'B', '0');
  await save(f.app);
  assert.equal(rawAWrites, 1); assert.equal(disk.get('A'), 'already on disk'); assert.equal(disk.has('B'), false);
  assert.deepEqual(choiceVisibility, [false]); assert.equal(controls(f.app, 'B')[0], draft);
  assert.equal(draft.value, '0'); assert.match(text(f.app), /Saved: A \(Task\)/);
  assert.match(text(f.app), /Saved; metadata pending/); assert.match(text(f.app), /Later required fields were not attempted/);
  assert.equal(button(f.app, 'Save required values').el.disabled, false);
  if (action.startsWith('retry')) {
    await save(f.app); assert.equal(rawAWrites, 1); assert.equal(aAttempts, 2);
    assert.deepEqual(choiceVisibility, [false]); assert.equal(disk.has('B'), false);
    visible = true;
    if (action === 'retry') f.state.values.set('A', disk.get('A'));
    await save(f.app); await pending;
    assert.equal(aAttempts, action === 'retry' ? 2 : 3); assert.equal(rawAWrites, 1); assert.equal(disk.get('B'), 'kept');
    assert.deepEqual(choiceVisibility, [false, true]); assert.equal(f.state.writes.length, 1);
  } else {
    button(f.app, 'Close').click(); await pending;
    assert.equal(disk.get('A'), 'already on disk'); assert.equal(disk.has('B'), false);
    assert.deepEqual(choiceVisibility, [false]); assert.equal(f.state.writes.length, 0);
  }
  assert.equal(f.state.target, target); assert.equal(f.app.closed, 1);
});
