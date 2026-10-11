import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const { outputFiles } = await build({ entryPoints: ['src/suggestion-row.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { renderNodeSuggestion } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`);
const hit = { label: 'Ada', entry: { type: 'person', file: { path: 'Nodes/Ada.md' } } };
function row() {
  return { spans: [], setAttribute() {}, createSpan({ text }) { const span = { text, style: {} }; this.spans.push(span); return span; } };
}
test('type tag uses schema color without adding an emoji or another line', () => {
  const colored = row();
  renderNodeSuggestion(hit, colored, 'green');
  assert.deepEqual(colored.spans.map(span => span.text), ['Ada', '#person']);
  assert.match(colored.spans[1].style.backgroundColor, /var\(--color-green\)/);
  const uncolored = row();
  renderNodeSuggestion(hit, uncolored);
  assert.equal(uncolored.spans[1].style.color, 'var(--text-muted)');
  assert.equal(uncolored.spans[1].style.backgroundColor, undefined);
});
