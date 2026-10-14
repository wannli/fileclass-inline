import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
// Share host identities with the bundle. The ASCII fuzzy stub has negative, gap-sensitive scores.
const { outputFiles } = await build({
  stdin: { contents: "export { NodeIndex } from './src/index'; export * from 'obsidian';", resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'host', setup(build) {
    build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'host' }));
    build.onLoad({ filter: /.*/, namespace: 'host' }, () => ({ contents: `
      export class TFile { constructor(path) { this.path = path; this.basename = path.split('/').pop().replace(/\\.[^.]+$/, ''); } }
      export class TFolder {}
      export const parseFrontMatterAliases = meta => { const a = meta?.aliases ?? meta?.alias; return typeof a === 'string' ? [a] : Array.isArray(a) ? a : []; };
      export const prepareFuzzySearch = query => label => {
        const term = query.toLowerCase(), value = label.toLowerCase(); let cursor = 0, first = -1, last = -1;
        for (const char of term) { const i = value.indexOf(char, cursor); if (i < 0) return null; if (first < 0) first = i; last = i; cursor = i + 1; }
        return { score: -(last - first + 1 - term.length) - value.length / 100 };
      };
    ` }));
  } }],
});
const { NodeIndex, TFile, TFolder, prepareFuzzySearch } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`);
function vault() {
  const files = new Map(), metadata = new Map(); let reads = 0, identities = 0;
  const app = { vault: { getAbstractFileByPath: path => { identities++; return files.get(path) ?? null; }, getMarkdownFiles() { throw Error('No vault scans'); } },
    metadataCache: { getFileCache(file) { reads++; return metadata.get(file); } } };
  return { app, files, metadata, reads: () => reads, identities: () => identities,
    add(path, frontmatter) { const file = new TFile(path); files.set(path, file); metadata.set(file, { frontmatter }); return file; } };
}
const member = (file, classes = ['person']) => ({ path: file.path, classes });
const paths = index => index.all().map(entry => entry.file.path);
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const compare = (a, b) => a.rank - b.rank || b.score - a.score || a.label.localeCompare(b.label) || a.entry.file.path.localeCompare(b.entry.file.path);
function reference(index, query, limit, type) {
  const term = query.trim().toLocaleLowerCase(), fuzzy = term && prepareFuzzySearch(query.trim());
  return index.all().filter(entry => !type || entry.classes.includes(type)).flatMap(entry => entry.labels.map(label => {
    const lower = label.toLocaleLowerCase(), match = fuzzy && fuzzy(label);
    return term && !match ? null : { entry, label, rank: !term ? 3 : lower === term ? 0 : lower.startsWith(term) ? 1 : 2, score: match?.score ?? 0 };
  }).filter(Boolean).sort(compare).slice(0, 1)).sort(compare).slice(0, Math.max(0, limit));
}
test('authoritative membership only; aliases, malformed data, duplicates and final-class precedence', async () => {
  const h = vault(), a = h.add('People/Ada.md', { type: 'wrong', aliases: ['Countess', 'Ada', '', ' ', 42, 'Countess'] });
  const raw = h.add('Nodes/Raw.md', { type: 'person' }), fake = { path: 'Fake.md' }; h.files.set(fake.path, fake); h.files.set('Folder', new TFolder());
  const classes = ['person', 'author'], index = new NodeIndex(h.app, async () => [member(a, classes), member(a, ['team', 'person', 'person']),
    null, { classes }, member(raw, []), { path: raw.path }, { path: 'Missing.md', classes }, { path: 'Folder', classes }, member(fake, classes)]);
  assert.deepEqual(index.all(), []); await index.rebuild(); classes.push('leak');
  assert.deepEqual(index.all(), [{ file: a, type: 'person', classes: ['author', 'team', 'person'], labels: ['Ada', 'Countess'] }]);
  for (const type of ['author', 'team', 'person']) assert.equal(index.search('', 20, type)[0].entry.file, a);
  assert.equal(index.search('countess')[0].label, 'Countess'); assert.deepEqual(index.search('', 20, 'wrong'), []);
});
test('exact > prefix > fuzzy, negative scores, stable ties and bounded heap match full-sort reference', async () => {
  const h = vault(), files = ['Z/Zed', 'Alpine', 'A little', 'A/AxxxB', 'B/AxB', 'Z/Same', 'A/Same', 'A/e\u0301', 'A/é']
    .map(path => h.add(`${path}.md`, path === 'Z/Zed' ? { aliases: ['Alfred', 'Al', 'A really long alias'] } : { aliases: ['Tie'] }));
  files.push(...Array.from({ length: 120 }, (_, i) => h.add(`Folder ${i % 3}/Node ${119 - i}.md`, { aliases: [`Alias ${i % 7}`, 'Same'] })));
  const index = new NodeIndex(h.app, async () => files.map((f, i) => member(f, i % 2 ? ['parent', 'child'] : ['other']))); await index.rebuild();
  assert.deepEqual(index.search(' AL ').map(hit => hit.rank).slice(0, 3), [0, 1, 1]);
  assert.deepEqual(index.search('ab').map(hit => hit.entry.file), [files[4], files[3]]);
  for (const q of ['', '  ', ' AL ', 'ab', 'same', 'node', 'a1', 'tie', 'none', 'é']) for (const k of [0, -1, 1, 2, 7, 20, 132, Infinity, 2.8, NaN])
    for (const type of [undefined, 'parent', 'child', 'other', 'missing']) assert.deepEqual(index.search(q, k, type), reference(index, q, k, type));
});
test('cached ordering and lowercase labels; search/all never load membership or metadata', async () => {
  const h = vault(), a = h.add('Zed.md', { alias: 'Alpha' }), b = h.add('Beta.md'); let calls = 0;
  const index = new NodeIndex(h.app, async () => { calls++; return [member(a), member(b)]; }); await index.rebuild();
  const reads = h.reads(), lower = String.prototype.toLocaleLowerCase; let labelLowers = 0;
  String.prototype.toLocaleLowerCase = function (...args) { if (['Zed', 'Alpha', 'Beta'].includes(String(this))) labelLowers++; return lower.apply(this, args); };
  try { for (let i = 0; i < 20; i++) { index.search('a'); index.search(''); index.all(); } } finally { String.prototype.toLocaleLowerCase = lower; }
  assert.equal(labelLowers, 0); assert.equal(calls, 1); assert.equal(h.reads(), reads);
  const identities = h.identities(); index.search('', 1); assert.equal(h.identities() - identities, 1);
  h.metadata.set(a, { frontmatter: { aliases: ['Omega'] } }); assert.equal(index.search('alpha')[0].entry.file, a);
  index.remember(a, ['updated']); assert.equal(index.search('')[0].entry.file, b); assert.deepEqual(index.search('alpha'), []);
  index.forget(b.path); assert.deepEqual(paths(index), [a.path]); assert.equal(index.search('')[0].label, 'Omega');
  index.clear(); assert.deepEqual(index.search(''), []); await index.rebuild(); assert.equal(index.search('').length, 2);
});
test('delete, replacement and rename identities are checked even with warm ordering', async () => {
  const h = vault(), a = h.add('A/Ada.md'), b = h.add('B/Ada.md'), c = h.add('C/Ada.md'); const members = [a, b, c].map(f => member(f));
  const index = new NodeIndex(h.app, async () => members); await index.rebuild(); index.search(''); h.files.delete(a.path); const replacement = h.add(b.path);
  assert.deepEqual(index.all().map(e => e.file), [c]); assert.deepEqual(index.search('ada').map(hit => hit.entry.file), [c]);
  await index.rebuild(); assert.deepEqual(index.all().map(e => e.file), [replacement, c]);
  h.files.delete(c.path); c.path = 'Renamed.md'; c.basename = 'Renamed'; h.files.set(c.path, c); assert.deepEqual(paths(index), [replacement.path]);
  await index.update(c, async () => ['renamed']); assert.equal(index.search('renamed')[0].entry.file, c);
});
test('rebuild resolves replacement identity after await, including null metadata', async () => {
  const h = vault(), a = h.add('Replaced.md', { aliases: ['Old'] }), wait = deferred(), index = new NodeIndex(h.app, () => wait.promise);
  const work = index.rebuild(), replacement = h.add(a.path); h.metadata.set(replacement, null); wait.resolve([member(a)]); await work;
  assert.equal(index.all()[0].file, replacement); assert.deepEqual(index.all()[0].labels, ['Replaced']);
});
for (const fail of [false, true]) test(`latest rebuild wins over stale ${fail ? 'failure' : 'success'}`, async () => {
  const h = vault(), a = h.add('Current.md'), old = deferred(), fresh = deferred(), queue = [old.promise, fresh.promise];
  const index = new NodeIndex(h.app, () => queue.shift()), first = index.rebuild(), second = index.rebuild(); fresh.resolve([member(a)]); assert.equal(await second, true);
  if (fail) old.reject(Error('old')); else old.resolve([]); assert.equal(await first, false); assert.deepEqual(paths(index), [a.path]);
});
test('failed full snapshots fail closed without partial publication, then recover', async () => {
  const h = vault(), a = h.add('A.md'), b = h.add('B.md'); let source = async () => [member(a), member(b)];
  const index = new NodeIndex(h.app, () => source()); assert.equal(await index.rebuild(), true);
  for (const bad of [() => { throw Error('unloaded'); }, async () => undefined]) { source = bad; assert.equal(await index.rebuild(), false); assert.deepEqual(index.all(), []); }
  source = async () => [member(a), member(b)]; const read = h.app.metadataCache.getFileCache;
  h.app.metadataCache.getFileCache = file => { if (file === b) throw Error('metadata'); return read(file); }; assert.equal(await index.rebuild(), false); assert.deepEqual(index.all(), []);
  h.app.metadataCache.getFileCache = read; await index.rebuild(); assert.deepEqual(paths(index), [a.path, b.path]);
  const old = deferred(); source = () => old.promise; const work = index.rebuild(); source = async () => { throw Error('current'); }; await index.rebuild();
  old.resolve([member(a)]); await work; assert.deepEqual(index.search(''), []);
});
for (const action of ['clear', 'dispose', 'forget', 'remember']) for (const fail of [false, true]) test(`${action} cancels only appropriate work (${fail})`, async () => {
  const h = vault(), a = h.add('A.md'), b = h.add('B.md'), full = deferred(), note = deferred(); let calls = 0, source = () => full.promise;
  const index = new NodeIndex(h.app, () => { calls++; return source(); }), work = index.rebuild(), update = index.update(a, () => note.promise);
  index[action](...(action === 'forget' ? [a.path] : action === 'remember' ? [a, ['confirmed']] : [])); const published = !fail && ['forget', 'remember'].includes(action);
  if (fail) { full.reject(Error('old')); note.reject(Error('old')); } else { full.resolve([member(a), member(b)]); note.resolve(['old']); } assert.deepEqual(await Promise.all([work, update]), [published, undefined]);
  assert.equal(calls, 1); assert.deepEqual(index.all().map(e => e.type).sort(), [...(action === 'remember' ? ['confirmed'] : []), ...(published ? ['person'] : [])]);
  source = async () => [member(a)]; assert.equal(await index.rebuild(), action !== 'dispose'); await index.update(a, async () => ['new']); index.remember(a, ['last']);
  assert.equal(calls, action === 'dispose' ? 1 : 2); assert.equal(index.all().length, action === 'dispose' ? 0 : 1);
});
test('remember snapshots classes, preserves positions, rejects invalid notes without cancelling rebuild', async () => {
  const h = vault(), a = h.add('A.md'), b = h.add('B.md'), old = h.add('Old.md'), replacement = h.add(old.path), wait = deferred();
  const index = new NodeIndex(h.app, () => wait.promise), work = index.rebuild(), fake = { path: 'Fake.md' }; h.files.set(fake.path, fake);
  for (const file of [old, fake, new TFile('Missing.md')]) index.remember(file, ['bad']);
  for (const classes of [[], ['', ' ', false, null], undefined]) index.remember(a, classes); assert.equal(h.reads(), 0);
  wait.resolve([member(a), member(b), member(replacement)]); await work; const classes = ['parent', 'child']; index.remember(a, classes); classes.push('leak');
  assert.deepEqual(paths(index), [a.path, b.path, replacement.path]); assert.deepEqual(index.all()[0].classes, ['parent', 'child']);
  const newA = h.add(a.path); index.remember(newA, ['replacement']); assert.equal(index.all()[0].file, newA);
});
for (const fail of [false, true]) test(`per-note latest request wins over stale ${fail ? 'failure' : 'success'}`, async () => {
  const h = vault(), a = h.add('A.md'), b = h.add('B.md'), old = deferred(), other = deferred(), index = new NodeIndex(h.app, async () => []);
  const first = index.update(a, () => old.promise), unrelated = index.update(b, () => other.promise);
  h.metadata.set(a, { frontmatter: { aliases: ['Fresh'] } }); await index.update(a, async () => ['parent', 'new']);
  h.metadata.set(a, { frontmatter: { aliases: ['Must not leak'] } }); if (fail) old.reject(Error('old')); else old.resolve(['old']);
  other.resolve(['independent']); await Promise.all([first, unrelated]); assert.equal(index.search('fresh')[0].entry.type, 'new'); assert.deepEqual(index.search('must'), []);
  assert.equal(index.search('', 20, 'parent').length, 1); await index.update(a, async () => []); assert.deepEqual(paths(index), [b.path]);
  await index.update(b, () => { throw Error('unavailable'); }); assert.deepEqual(index.search(''), []);
});
for (const mode of ['rename', 'replace', 'delete', 'rebuild']) test(`pending update cannot write stale identity or type after ${mode}`, async () => {
  const h = vault(), a = h.add('A.md'), wait = deferred(), index = new NodeIndex(h.app, async () => [member(a, ['full'])]); const work = index.update(a, () => wait.promise);
  if (mode === 'rename') { h.files.delete(a.path); a.path = 'B.md'; a.basename = 'B'; h.files.set(a.path, a); }
  if (mode === 'replace') h.add(a.path); if (mode === 'delete') h.files.delete(a.path); if (mode === 'rebuild') await index.rebuild();
  const reads = h.reads(); wait.resolve(['stale']); await work; assert.equal(h.reads(), reads); assert.deepEqual(index.all().map(e => e.type), mode === 'rebuild' ? ['full'] : []);
});
for (const finishUpdateFirst of [false, true]) for (const fail of [false, true]) test(`rebuild merges overlapping updates (${finishUpdateFirst}, ${fail})`, async () => {
  const h = vault(), a = h.add('A.md'), b = h.add('B.md'), c = h.add('C.md'), full = deferred(), note = deferred();
  const index = new NodeIndex(h.app, () => full.promise); index.remember(c, ['removed']); const work = index.rebuild(), update = index.update(a, () => note.promise);
  await index.update(c, async () => []); if (finishUpdateFirst) { note.resolve(['new']); await update; }
  if (fail) full.reject(Error('old source')); else full.resolve([member(a, ['stale']), member(b), member(c)]); assert.equal(await work, !fail);
  if (!finishUpdateFirst) { note.resolve(['new']); await update; }
  assert.equal(index.search('a')[0].entry.type, 'new'); assert.deepEqual(index.search('c'), []); assert.equal(index.all().length, fail ? 1 : 2);
});
test('incremental alias/type changes invalidate warmed ordering; bad identity never invokes the loader', async () => {
  const h = vault(), a = h.add('A.md'), b = h.add('B.md'), index = new NodeIndex(h.app, async () => [member(a), member(b)]); await index.rebuild();
  assert.equal(index.search('', 1)[0].entry.file, a); h.metadata.set(b, { frontmatter: { aliases: ['0 Fresh'] } });
  const classes = ['parent', 'child']; await index.update(b, async () => classes); classes.push('leak');
  assert.equal(index.search('', 1)[0].entry.file, b); assert.deepEqual(index.search('fresh')[0].entry.classes, ['parent', 'child']);
  const missing = new TFile('Missing.md'), old = h.add('Old.md'), fake = { path: 'Fake.md' }; h.add(old.path); h.files.set(fake.path, fake);
  let calls = 0; for (const file of [missing, old, fake]) await index.update(file, async () => { calls++; return ['bad']; }); assert.equal(calls, 0);
  h.app.metadataCache.getFileCache = () => { throw Error('metadata unavailable'); }; await index.update(b, async () => ['new']);
  assert.deepEqual(paths(index), [a.path]); assert.equal(index.search('', 1)[0].entry.file, a);
});
test('rebuild override is request-local and reports publication, failure and disposal', async () => {
  const h = vault(), a = h.add('Default.md'), b = h.add('Pinned.md'); let calls = 0, overrides = 0;
  const index = new NodeIndex(h.app, async () => { calls++; return [member(a)]; });
  const override = async () => { overrides++; return [member(b)]; };
  assert.equal(await index.rebuild(override), true); assert.deepEqual(paths(index), [b.path]); assert.equal(calls, 0);
  assert.equal(await index.rebuild(), true); assert.deepEqual(paths(index), [a.path]); assert.equal(calls, 1);
  assert.equal(await index.rebuild(async () => { throw Error('aborted source'); }), false); assert.deepEqual(index.all(), []);
  assert.equal(await index.rebuild(async () => []), true); index.dispose(); assert.equal(await index.rebuild(override), false); assert.equal(overrides, 1);
});
for (const action of ['merge', 'clear', 'dispose', 'rebuild']) test(`projection yields a timer turn, then ${action} (${action === 'merge' ? 'one scan' : 'stop stale reads'})`, async () => {
  const h = vault(), files = Array.from({ length: 300 }, (_, i) => h.add(`${i}.md`, { aliases: ['Shared'] })), created = h.add('Created.md'); let calls = 0;
  const index = new NodeIndex(h.app, async () => { throw Error('must use pinned loader'); }), turn = new Promise(resolve => setTimeout(resolve, 0));
  const work = index.rebuild(async () => { calls++; return files.map(f => member(f)); }); await turn; assert.equal(h.reads(), 128); assert.deepEqual(index.all(), []);
  index.remember(created, ['captured']); index.remember(files[0], ['new']); index.forget(files[1].path); index.forget(files[200].path);
  h.metadata.set(files[2], { frontmatter: { aliases: ['Fresh'] } }); await index.update(files[2], async () => ['updated']);
  if (action === 'rebuild') assert.equal(await index.rebuild(async () => [member(created, ['latest'])]), true); else if (action !== 'merge') index[action]();
  const reads = h.reads(); assert.equal(await work, action === 'merge'); assert.equal(calls, 1);
  if (action === 'merge') {
    assert.equal(index.all().length, 299); assert.equal(index.search('0')[0].entry.type, 'new'); assert.equal(index.search('fresh')[0].entry.type, 'updated');
    assert.equal(paths(index).includes(files[1].path), false); assert.equal(paths(index).includes(files[200].path), false); assert.equal(index.isAmbiguous('shared'), true);
  } else { assert.equal(h.reads(), reads); assert.deepEqual(index.all().map(e => e.type), action === 'rebuild' ? ['latest'] : []); }
});
test('ambiguity counts distinct notes, not repeated normalized labels, with no per-row scans', async () => {
  const h = vault(), a = h.add('A/Shared.md', { aliases: ['SHARED', ' shared ', 'Nick', 'NICK'] }), b = h.add('B/shared.md', { aliases: ['nick', 'Unique'] }); let calls = 0;
  const index = new NodeIndex(h.app, async () => { calls++; return [member(a)]; }); await index.rebuild();
  assert.equal(index.isAmbiguous('shared'), false); assert.equal(index.isAmbiguous('nick'), false); index.remember(b, ['person']);
  const identities = h.identities(), reads = h.reads(); for (let i = 0; i < 20; i++) { assert.equal(index.isAmbiguous(' SHARED '), true); assert.equal(index.isAmbiguous('NICK'), true); }
  assert.equal(index.isAmbiguous('unique'), false); assert.equal(h.identities(), identities); assert.equal(h.reads(), reads); assert.equal(calls, 1);
  index.remember(b, ['new']); index.forget(b.path); assert.equal(index.isAmbiguous('shared'), false); assert.equal(index.isAmbiguous('nick'), false);
  index.remember(b, ['person']); h.metadata.set(b, { frontmatter: { aliases: ['Other'] } }); await index.update(b, async () => ['person']);
  assert.equal(index.isAmbiguous('nick'), false); assert.equal(index.isAmbiguous('shared'), true); await index.update(b, async () => []); assert.equal(index.isAmbiguous('shared'), false);
  assert.equal(await index.rebuild(async () => [member(a), member(b)]), true); assert.equal(index.isAmbiguous('shared'), true); index.clear(); assert.equal(index.isAmbiguous('shared'), false);
  await index.rebuild(async () => [member(a), member(b)]); await index.rebuild(async () => { throw Error('failed'); }); assert.equal(index.isAmbiguous('shared'), false);
  index.remember(a, ['person']); index.remember(b, ['person']); index.dispose(); assert.equal(index.isAmbiguous('shared'), false);
});
test('optional 10,000-note benchmark (host Node latency, not a device claim)', { skip: !process.env.INDEX_BENCH }, async () => {
  const h = vault(), files = Array.from({ length: 10000 }, (_, i) => h.add(`Folder ${i % 10}/Node ${i}.md`, { aliases: [`Alias ${i}`] })); let calls = 0;
  const index = new NodeIndex(h.app, async () => { calls++; return files.map(f => member(f)); }); await index.rebuild(); const reads = h.reads();
  const start = performance.now(); index.search(''); console.log(`10k empty cold: ${(performance.now() - start).toFixed(2)}ms`);
  for (const query of ['', 'node', 'a19']) {
    let start = performance.now(); for (let i = 0; i < 40; i++) index.search(query); const mean = (performance.now() - start) / 40;
    start = performance.now(); for (let i = 0; i < 40; i++) reference(index, query, 20);
    console.log(`10k ${JSON.stringify(query)} mean: ${mean.toFixed(3)}ms; full-sort reference: ${((performance.now() - start) / 40).toFixed(3)}ms`);
  }
  assert.equal(calls, 1); assert.equal(h.reads(), reads); console.log(`source calls: ${calls}; metadata reads during search: ${h.reads() - reads}`);
});
