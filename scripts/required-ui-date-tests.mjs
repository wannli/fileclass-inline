import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, field, tick, row, controls, input, save, text } from './required-ui-fixture.mjs';

for (const [options, value] of [
  [{ dateFormat: 'DD.MM.YYYY' }, '13.10.2026'],
  [{ dateFormat: 'ddd, MMM Do YYYY' }, 'Tue, Oct 13th 2026'],
  [{ dateFormat: 'YYYY-MM-DD' }, '[[Journal/2026-10-13|Tuesday]]'],
  [{}, '  [[Journal/13-10-2026|Custom date]]  '],
  [{ dateFormat: '' }, '2026/10/13'],
  [{ dateFormat: 42 }, '13 Oct 2026'],
]) test(`Date remains raw text with a declared or unknown-format hint: ${JSON.stringify(options)}`, async () => {
  const f = fixture([field('date', 'Date', { options })]);
  Object.defineProperty(f.app, 'plugins', { get() { throw Error('Private Fileclass settings must not be inspected'); } });
  const pending = f.start(); await tick();
  const control = controls(f.app, 'date')[0]; assert.equal(control.type, 'text');
  const hint = row(f.app, 'date').setting.descEl.text;
  if (typeof options.dateFormat === 'string' && options.dateFormat) assert.ok(hint.includes(`Fileclass date format: ${options.dateFormat}`));
  else assert.match(hint, /Use your Fileclass date format; its global default is not exposed\./);
  input(f.app, 'date', value); await save(f.app); await pending;
  assert.equal(f.state.writes.length, 1); assert.equal(f.state.writes[0].value, value);
  assert.equal(f.state.writes[0].field, f.state.issued[0][0]);
});
test('Date locally rejects only a missing/blank string and delegates custom-format validation and retry', async () => {
  const f = fixture([field('date', 'Date', { options: { dateFormat: 'DD/MM/YYYY' } })]);
  const write = f.backend.setValue, attempted = [];
  f.backend.setValue = async (...args) => {
    attempted.push(args[2]);
    if (args[2] !== '13/10/2026') throw Error('Fileclass requires DD/MM/YYYY');
    await write(...args);
  };
  const pending = f.start(); await tick(); input(f.app, 'date', '   '); await save(f.app);
  assert.deepEqual(attempted, []); assert.match(text(f.app), /A value is required/);
  input(f.app, 'date', 'not a date'); await save(f.app);
  assert.deepEqual(attempted, ['not a date']); assert.match(text(f.app), /Fileclass requires DD\/MM\/YYYY/);
  assert.equal(controls(f.app, 'date')[0].value, 'not a date'); assert.equal(f.app.closed, 0);
  input(f.app, 'date', '13/10/2026'); await save(f.app); await pending;
  assert.deepEqual(attempted, ['not a date', '13/10/2026']); assert.equal(f.state.writes[0].value, '13/10/2026');
});
