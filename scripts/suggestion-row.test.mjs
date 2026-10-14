import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { devices, expectSuggestionStyle, expectClassIcon, pointerDocument } from './suggestion-test-helpers.mjs';

const { outputFiles } = await build({
  stdin: { contents: `export { renderNodeSuggestion } from './src/suggestion-row';
    export { styleSuggestionItem, renderClassIcon } from './src/suggestion-style';
    export { AtSuggest } from './src/at-suggest'; export { LinkPicker } from './src/link-picker';
    export { NodeIndex } from './src/index'; export { iconCalls, Platform, TFile } from 'obsidian';`, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'obsidian-icons', setup(build) {
    build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'host' }));
    build.onLoad({ filter: /.*/, namespace: 'host' }, () => ({ contents: `
      export const Platform = { isMobile: false };
      export const iconCalls = [];
      export function setIcon(el, icon) { iconCalls.push({ el, icon }); }
      export class EditorSuggest { constructor(app) { this.app = app; } }
      export class SuggestModal { constructor(app) { this.app = app; } setPlaceholder(value) { this.placeholder = value; } }
      export class TFile { constructor(path) { this.path = path; this.basename = path.split('/').at(-1).replace(/\\.md$/, ''); } }
      export class Notice { constructor() { throw Error('Rendering must not invoke a notice'); } }
      export const parseFrontMatterAliases = meta => meta?.aliases ?? [];
      export const prepareFuzzySearch = query => label => label.toLowerCase().includes(query.toLowerCase()) ? { score: 0 } : null;
    ` }));
  } }],
});
const { renderNodeSuggestion, styleSuggestionItem, renderClassIcon, AtSuggest, LinkPicker, NodeIndex, iconCalls, Platform, TFile } =
  await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`);
const hit = { label: 'Ada', entry: { type: 'person', file: { path: 'People/Ada.md' } } };
function row(text = '', ownerDocument = pointerDocument(false)) {
  return {
    text, ownerDocument, spans: [], children: [], attributes: {},
    style: { setProperty(name, value) { this[name] = value; } },
    setAttribute(name, value) { this.attributes[name] = value; },
    createEl(tag, { text = '', attr = {} } = {}) {
      const child = row(text, this.ownerDocument); child.tag = tag; child.attributes = { ...attr };
      this.children.push(child); if (tag === 'span') this.spans.push(child); return child;
    },
    createSpan(options) { return this.createEl('span', options); },
    get textContent() { return this.text + this.children.map(child => child.textContent).join(''); },
  };
}
function useDevice(t, device) {
  const mobile = Platform.isMobile; Platform.isMobile = device.mobile;
  t.after(() => { Platform.isMobile = mobile; });
  iconCalls.length = 0;
  return () => row('', pointerDocument(device.coarse));
}

test('legacy single-type hit renders a muted badge without an icon or another line', () => {
  iconCalls.length = 0;
  const el = row();
  renderNodeSuggestion(hit, el);
  assert.deepEqual(el.spans.map(span => span.textContent), ['Ada', '#person']);
  assert.equal(el.spans[1].style.color, 'var(--text-muted)');
  assert.equal(el.spans[1].style.backgroundColor, undefined);
  assert.equal(el.attributes.title, 'People/Ada.md');
  assert.match(el.attributes['aria-label'], /Ada.*person.*People\/Ada\.md/);
  assert.equal(iconCalls.length, 0);
  expectSuggestionStyle(el, devices[0]);
});

test('all classes retain Fileclass glyphs at native icon size independent of smaller badge text', () => {
  iconCalls.length = 0;
  const el = row(), names = [];
  const multi = { ...hit, entry: { ...hit.entry, type: 'author', classes: ['person', 'author', 'team'] } };
  const decorations = {
    person: { name: 'person', icon: 'user-round' },
    author: { name: 'author', icon: 'notebook-pen' },
    team: { name: 'team', icon: 'users-round' },
  };
  renderNodeSuggestion(multi, el, name => { names.push(name); return decorations[name]; });
  assert.deepEqual(names, ['person', 'author', 'team']);
  assert.deepEqual(el.spans.map(span => span.textContent), ['Ada', '#person', '#author', '#team']);
  assert.deepEqual(iconCalls.map(call => call.icon), ['user-round', 'notebook-pen', 'users-round']);
  for (const [i, call] of iconCalls.entries()) {
    assert.equal(call.el, el.spans[i + 1].spans[0]);
    expectClassIcon(call.el);
    assert.equal(el.spans[i + 1].style.fontSize, 'var(--font-smaller)');
    assert.equal(el.spans[i + 1].style.color, 'var(--text-muted)');
    assert.equal(el.spans[i + 1].style.backgroundColor, undefined);
  }
  assert.equal(el.attributes['aria-label'], 'Ada, classes person, author, team, People/Ada.md');
});

test('missing decorations or icons still render every class badge', () => {
  iconCalls.length = 0;
  const el = row();
  renderNodeSuggestion({ ...hit, entry: { ...hit.entry, classes: ['person', 'team', 'project'] } }, el,
    name => name === 'team' ? undefined : { name });
  assert.deepEqual(el.spans.map(span => span.textContent), ['Ada', '#person', '#team', '#project']);
  assert.equal(iconCalls.length, 0);
  for (const badge of el.spans.slice(1)) assert.equal(badge.style.color, 'var(--text-muted)');
});

test('legacy fallback type also supports Fileclass icon decoration', () => {
  iconCalls.length = 0;
  const el = row();
  renderNodeSuggestion(hit, el, name => ({ name, icon: 'user' }));
  assert.deepEqual(iconCalls.map(call => call.icon), ['user']);
  assert.equal(el.spans[1].textContent, '#person');
  expectClassIcon(iconCalls[0].el);
});

for (const device of devices) test(`shared existing-note rows: ${device.name}, stable labels and accessible ambiguous paths`, t => {
  const makeRow = useDevice(t, device), el = makeRow();
  renderNodeSuggestion(hit, el, name => ({ name, icon: 'user-round' }));
  expectSuggestionStyle(el, device);
  assert.equal(el.style.flexWrap, 'nowrap');
  assert.equal(el.style.whiteSpace, 'nowrap');
  assert.equal(el.style.overflow, 'hidden');
  assert.equal(el.spans[0].style.minWidth, '0');
  assert.equal(el.spans[0].style.textOverflow, 'ellipsis');
  assert.equal(el.spans[1].style.flexShrink, '0');
  assert.equal(el.textContent, 'Ada#person');
  expectClassIcon(iconCalls[0].el);

  const first = makeRow(), second = makeRow();
  renderNodeSuggestion(hit, first, undefined, true);
  renderNodeSuggestion({ ...hit, entry: { ...hit.entry, file: { path: 'People/Augusta.md' } } }, second, undefined, true);
  for (const [item, path] of [[first, 'People/Ada.md'], [second, 'People/Augusta.md']]) {
    expectSuggestionStyle(item, device, true);
    assert.equal(item.spans[0].textContent, 'Ada#person');
    assert.equal(item.spans[0].style.display, 'flex');
    assert.equal(item.spans[0].style.alignItems, 'center');
    assert.equal(item.spans[1].textContent, path);
    assert.equal(item.spans[1].style.whiteSpace, 'normal');
    assert.equal(item.spans[1].style.overflowWrap, 'anywhere');
    assert.equal(item.attributes.title, path);
    assert.ok(item.attributes['aria-label'].includes(path));
  }
});

function menuFixture(surface) {
  const files = new Map(['People/Ada.md', 'People/Augusta.md'].map(path => [path, new TFile(path)]));
  const app = {
    vault: { getAbstractFileByPath: path => files.get(path) },
    metadataCache: { getFileCache: () => ({ frontmatter: { aliases: ['Shared'] } }) },
  };
  const index = new NodeIndex(app, async () => { assert.fail('Finding/rendering cannot load Fileclass membership'); });
  for (const file of files.values()) index.remember(file, ['person']);
  app.metadataCache.getFileCache = () => assert.fail('Rendering cannot read metadata');
  const decoration = name => ({ name, icon: 'user-round' });
  const menu = surface === 'AtSuggest'
    ? new AtSuggest(app, { index, typeInfo: decoration, available: () => true })
    : new LinkPicker(app, index, () => assert.fail('Rendering cannot choose a result'), '', decoration);
  return { menu, suggestions: query => menu.getSuggestions(surface === 'AtSuggest' ? { query } : query) };
}

for (const surface of ['AtSuggest', 'LinkPicker']) for (const device of devices) {
  test(`${surface}: existing/create/ambiguous rows on ${device.name}`, t => {
    const makeRow = useDevice(t, device), { menu, suggestions } = menuFixture(surface);
    const unique = suggestions('Ada').find(choice => choice.kind === 'existing');
    const ordinary = makeRow(); menu.renderSuggestion(unique, ordinary);
    expectSuggestionStyle(ordinary, device);
    assert.equal(ordinary.textContent, 'Ada#person');
    assert.equal(ordinary.spans.length, 2);
    expectClassIcon(iconCalls[0].el);

    const choices = suggestions('Shared');
    assert.deepEqual(choices.map(choice => choice.kind), ['existing', 'existing', 'create']);
    const paths = [];
    for (const choice of choices.filter(choice => choice.kind === 'existing')) {
      const el = makeRow(); menu.renderSuggestion(choice, el);
      expectSuggestionStyle(el, device, true);
      assert.equal(el.spans[0].textContent, 'Shared#person');
      assert.equal(el.spans[1].textContent, choice.hit.entry.file.path);
      paths.push(el.spans[1].textContent);
      assert.equal(el.spans[1].style.overflowWrap, 'anywhere');
    }
    assert.deepEqual(paths.sort(), ['People/Ada.md', 'People/Augusta.md']);
    assert.deepEqual(iconCalls.map(call => call.icon), ['user-round', 'user-round', 'user-round']);
    iconCalls.forEach(call => expectClassIcon(call.el));

    const create = makeRow(); menu.renderSuggestion(choices.at(-1), create);
    expectSuggestionStyle(create, device);
    assert.equal(create.textContent, 'Create “Shared”…');
    assert.equal(iconCalls.length, 3, 'create rows do not invent a class icon');
  });
}

test('shared helper resets a reused touch/stacked row to native desktop density', t => {
  const mobile = Platform.isMobile; Platform.isMobile = false;
  t.after(() => { Platform.isMobile = mobile; });
  const queries = [], el = row('', pointerDocument(true, queries));
  styleSuggestionItem(el, true); expectSuggestionStyle(el, devices[2], true);
  el.ownerDocument = pointerDocument(false, queries);
  styleSuggestionItem(el); expectSuggestionStyle(el, devices[0]);
  assert.equal(el.style.justifyContent, '');
  assert.deepEqual(queries, ['(any-pointer: coarse)', '(any-pointer: coarse)']);
});

test('mobile works without matchMedia; missing renderer/window capability stays native on desktop', t => {
  const mobile = Platform.isMobile;
  t.after(() => { Platform.isMobile = mobile; });
  for (const ownerDocument of [undefined, { defaultView: null }, { defaultView: {} }]) {
    const el = row(); el.ownerDocument = ownerDocument;
    Platform.isMobile = true; styleSuggestionItem(el); expectSuggestionStyle(el, devices[1]);
    Platform.isMobile = false; styleSuggestionItem(el); expectSuggestionStyle(el, devices[0]);
  }
});

test('renderClassIcon returns its aligned span and passes the supplied glyph unchanged', () => {
  iconCalls.length = 0;
  const parent = row(); parent.style.fontSize = 'var(--font-smaller)';
  const icon = renderClassIcon(parent, 'notebook-pen');
  assert.equal(icon, parent.spans[0]);
  assert.deepEqual(iconCalls, [{ el: icon, icon: 'notebook-pen' }]);
  expectClassIcon(icon);
  assert.equal(parent.textContent, '');
});
