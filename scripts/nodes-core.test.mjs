import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundled = await build({ entryPoints: ['src/schema.ts', 'src/create.ts'], bundle: true, platform: 'node', format: 'esm', outdir: 'out', write: false,
  plugins: [{ name: 'host-stub', setup(build) {
    build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'stub' }));
    build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export class TFolder {}; export const parseYaml = JSON.parse; export const stringifyYaml = obj => Object.entries(obj).map(([k,v]) => `${k}: ${JSON.stringify(v)}`).join("\\n");', loader: 'js' }));
  } }],
});
const moduleAt = async suffix => import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles.find(file => file.path.endsWith(suffix)).contents).toString('base64')}`);
const { validateSchema } = await moduleAt('schema.js');
const { validateValues, renderNode, titleError } = await moduleAt('create.js');
const input = { nodeSchema: 1, nodeType: 'person', highlight: 'green', properties: { active: { kind: 'checkbox', requiredOnCreate: true }, score: { kind: 'number', default: 0 } } };
const schema = validateSchema(input, '# {{title}}', 'Schemas/person.md').schema;

test('required boolean accepts false; clearing default does not restore it', () => {
  assert.deepEqual(validateValues(schema, {}), ['active: required']);
  assert.deepEqual(validateValues(schema, { active: false }), []);
  assert.doesNotMatch(renderNode(schema, 'Ada', { active: false, score: '' }, '2026-10-11'), /score:/);
  const draft = renderNode(schema, 'Ada', { active: false }, '2026-10-11', 'Idea\nsecond line');
  assert.match(draft, /^---\ntype: "person"\nschema: 1\n/m);
  assert.match(draft, /# Ada\n\nIdea\nsecond line$/);
});

test('invalid schema and filenames cannot write a draft', () => {
  assert.equal(schema.highlight, 'green');
  assert.ok(validateSchema({ ...input, highlight: 'brown' }, '', 'Schemas/person.md').errors.some(error => error.startsWith('highlight:')));
  assert.ok(validateSchema({ ...input, properties: { type: { kind: 'text' } } }, '', 'Schemas/person.md').errors.length);
  assert.ok(validateSchema({ ...input, properties: { schema: { kind: 'number' } } }, '', 'Schemas/person.md').errors.some(error => error.includes('reserved property')));
  assert.ok(titleError('../Ada'));
  assert.throws(() => renderNode(schema, '../Ada', { active: false }, '2026-10-11'));
});
