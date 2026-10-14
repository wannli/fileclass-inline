import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, field, tick, deferred, controls, button, save } from './required-ui-fixture.mjs';

for (const [type, tag] of [['Input', 'input'], ['MultiInput', 'textarea'], ['Boolean', 'select'], ['File', 'input']]) {
  test(`initial load moves native Close autofocus to the first required ${type} control/filter`, async () => {
    const f = fixture([field('unsupported', 'Object'), field('A', type)]);
    if (type === 'File') f.state.choices.A = Array.from({ length: 31 }, (_, index) => ({ value: `[[Note ${index}]]`, label: `Note ${index}` }));
    const pending = f.start(); await tick();
    const document = f.app.dialog.contentEl.ownerDocument, first = controls(f.app, 'A')[0];
    assert.equal(document.focusCalls[0].el, button(f.app, 'Close').el);
    assert.equal(document.activeElement, first); assert.equal(first.tag, tag); assert.equal(first.disabled, false);
    if (type === 'File') assert.equal(first.placeholder, 'Filter choices');
    assert.deepEqual(document.focusCalls.at(-1).options, { preventScroll: true });
    f.app.dialog.close(); await pending;
  });
}
test('initial focus does not replace focus already inside a required field', async () => {
  const f = fixture([field('A'), field('B', 'Select')]), waiting = deferred();
  f.backend.choices = () => waiting.promise;
  const pending = f.start(); await tick(); const dialog = f.app.dialog, setBusy = dialog.setBusy.bind(dialog);
  // Model focus entering B as controls are enabled, before the initial-focus fallback runs.
  dialog.setBusy = busy => { setBusy(busy); if (!busy) controls(f.app, 'B')[0].focus(); };
  waiting.resolve([]); await tick();
  const document = dialog.contentEl.ownerDocument;
  assert.equal(document.activeElement, controls(f.app, 'B')[0]); assert.equal(document.focusCalls.length, 2);
  dialog.close(); await pending;
});
test('later save/refresh does not autofocus again', async () => {
  const f = fixture([field('A')]); const pending = f.start(); await tick();
  const document = f.app.dialog.contentEl.ownerDocument, close = button(f.app, 'Close').el;
  close.focus(); const count = document.focusCalls.length;
  await save(f.app); // Blank required value leaves the form open and refreshes its controls.
  assert.equal(f.app.closed, 0); assert.equal(document.activeElement, close); assert.equal(document.focusCalls.length, count);
  f.app.dialog.close(); await pending;
});
test('unsupported-only forms leave native focus on Close', async () => {
  const f = fixture([field('A', 'Object')]); const pending = f.start(); await tick();
  const document = f.app.dialog.contentEl.ownerDocument;
  assert.equal(document.activeElement, button(f.app, 'Close').el); assert.equal(document.focusCalls.length, 1);
  f.app.dialog.close(); await pending;
});
for (const mode of ['abort', 'close']) test(`${mode} during initial load prevents late autofocus`, async () => {
  const f = fixture([field('A', 'Select')]), waiting = deferred(), controller = new AbortController();
  f.backend.choices = () => waiting.promise;
  const pending = f.start(controller.signal); await tick();
  const document = f.app.dialog.contentEl.ownerDocument, count = document.focusCalls.length;
  if (mode === 'abort') controller.abort(); else button(f.app, 'Close').click();
  await pending; waiting.resolve([]); await tick();
  assert.equal(document.focusCalls.length, count); assert.equal(document.activeElement, null);
});
