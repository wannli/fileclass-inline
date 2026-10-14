import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, field, tick, text, row, walk, controls, button, save, check } from './required-ui-fixture.mjs';

const choices = size => Array.from({ length: size }, (_, index) => ({ label: `Candidate ${index}`, value: `[[Folder/Note ${index}|Alias ${index}]]` }));
const filter = app => controls(app, 'A').find(el => el.placeholder === 'Filter choices');
const boxes = app => controls(app, 'A').filter(el => el.type === 'checkbox');
function query(app, value) { const el = filter(app); el.value = value; el.control.change(value); }
function touch(el) {
  assert.equal(el.style.minHeight, '44px'); assert.equal(el.style.minWidth, '44px');
  assert.equal(el.style.animation, 'none'); assert.equal(el.style.transition, 'none');
}

test('large File lists bound native options, keep filter focus and preserve full selected serialization', async () => {
  const f = fixture([field('A', 'File')]); f.state.choices.A = choices(1000);
  const pending = f.start(); await tick(); const search = filter(f.app), select = controls(f.app, 'A').find(el => el.tag === 'select');
  const requests = f.state.choiceRequests.length; search.focus(); touch(search); touch(select);
  assert.ok(Object.keys(select.control.options).length <= 31);
  query(f.app, 'Candidate 999'); assert.deepEqual(select.control.options, { '': 'Not set', 999: 'Candidate 999' });
  select.control.change('999'); query(f.app, '');
  assert.ok(Object.keys(select.control.options).length <= 31); assert.equal(select.value, '999');
  query(f.app, 'does not exist'); assert.equal(select.value, '999'); assert.match(text(f.app), /No matching choices. Current selection retained/);
  assert.equal(filter(f.app), search); assert.equal(globalThis.requiredFocused, search);
  assert.ok(walk(row(f.app, 'A')).includes(search)); assert.equal(f.state.choiceRequests.length, requests);
  await save(f.app); await pending; assert.equal(f.state.values.get('A'), f.state.choices.A[999].value);
});
for (const type of ['Multi', 'MultiFile']) test(`large ${type} lists are bounded and preserve selections across filtering/paging`, async () => {
  const f = fixture([field('A', type)]); f.state.choices.A = choices(1000);
  const pending = f.start(); await tick(); const search = filter(f.app), requests = f.state.choiceRequests.length;
  assert.equal(boxes(f.app).length, 40); check(f.app, 'A', 'Candidate 0');
  search.focus(); query(f.app, 'Candidate 999'); check(f.app, 'A', 'Candidate 999');
  query(f.app, 'no match'); assert.equal(boxes(f.app).length, 0); assert.match(text(f.app), /No matching choices; 2 selected/);
  button(f.app, 'Show selected (2)').click(); assert.equal(search.value, ''); assert.equal(boxes(f.app).length, 2);
  assert.ok(boxes(f.app).every(el => el.checked)); button(f.app, 'Show all choices').click();
  button(f.app, 'Next choices').click(); assert.equal(boxes(f.app).length, 40); check(f.app, 'A', 'Candidate 39');
  query(f.app, 'Candidate 999'); const selected = boxes(f.app)[0]; assert.equal(selected.checked, true);
  selected.checked = false; selected.listeners.change(); query(f.app, ''); assert.equal(boxes(f.app).length, 40);
  assert.equal(filter(f.app), search); assert.equal(globalThis.requiredFocused, search);
  assert.equal(f.state.choiceRequests.length, requests);
  for (const el of walk(row(f.app, 'A')).filter(el => el.tag === 'label' || el.tag === 'button')) touch(el);
  await save(f.app); await pending;
  assert.deepEqual(f.state.values.get('A'), [f.state.choices.A[0].value, f.state.choices.A[39].value]);
});
test('even more than one page of selections remains bounded and accessible', async () => {
  const f = fixture([field('A', 'MultiFile')]); f.state.choices.A = choices(1000);
  const pending = f.start(); await tick();
  for (let page = 0; page < 2; page++) {
    for (const el of boxes(f.app)) { el.checked = true; el.listeners.change(); }
    if (!page) button(f.app, 'Next choices').click();
  }
  button(f.app, 'Show selected (80)').click(); assert.equal(boxes(f.app).length, 40);
  assert.ok(boxes(f.app).every(el => el.checked)); button(f.app, 'Next choices').click();
  assert.equal(boxes(f.app).length, 40); assert.ok(boxes(f.app).every(el => el.checked));
  query(f.app, 'Candidate 79'); assert.equal(boxes(f.app).length, 1); assert.equal(boxes(f.app)[0].checked, true);
  const search = filter(f.app), requests = f.state.choiceRequests.length;
  f.app.dialog.close(); await pending; search.control.change('late');
  assert.equal(search.disabled, true); assert.equal(f.app.dialog.contentEl.children.length, 0); assert.equal(f.state.choiceRequests.length, requests);
});
test('small lists add no filter/paging clicks; checkboxes and primary actions have non-animated 44px targets', async () => {
  const f = fixture([field('A', 'Multi'), field('B', 'File')]); f.state.choices.A = choices(2); f.state.choices.B = choices(2);
  const pending = f.start(); await tick();
  assert.equal(filter(f.app), undefined); assert.equal(controls(f.app, 'B').length, 1);
  assert.equal(boxes(f.app).length, 2);
  for (const el of walk(row(f.app, 'A')).filter(el => el.tag === 'label')) touch(el);
  touch(button(f.app, 'Save required values').el); touch(button(f.app, 'Close').el);
  assert.equal(controls(f.app, 'A').filter(el => el.tag === 'button').length, 0);
  f.app.dialog.close(); await pending;
});
