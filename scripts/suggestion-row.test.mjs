import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const { outputFiles } = await build({ entryPoints: ['src/suggestion-row.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { renderNodeSuggestion } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`);
const hit = { label: 'Ada', entry: { type: 'person', file: { path: 'Nodes/Ada.md' } } };
function row() {
  return { spans: [], setAttribute() {}, createSpan({ text }) { const span = { text, style: {} }; this.spans.push(span); return span; } };
}
test('type tag is muted and stays on the suggestion row', () => {
  const suggestion = row();
  renderNodeSuggestion(hit, suggestion);
  assert.deepEqual(suggestion.spans.map(span => span.text), ['Ada', '#person']);
  assert.equal(suggestion.spans[1].style.color, 'var(--text-muted)');
  assert.equal(suggestion.spans[1].style.backgroundColor, undefined);
});
