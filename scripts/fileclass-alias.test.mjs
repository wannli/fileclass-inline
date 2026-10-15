import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const { outputFiles } = await build({ entryPoints: ['src/fileclass.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'host', setup(build) {
    build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'host', namespace: 'stub' }));
    build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export class TFile {}' }));
  } }] });
const { FileclassBridge } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`);
function fixture(registry = false) {
  const api = { version: '1.1', ...Object.fromEntries(['listFileClasses', 'getSchema', 'getFields', 'getValue', 'allowedValues', 'fileCandidates', 'explain', 'setValue'].map(name => [name, async () => []])) };
  const plugin = { api, settings: { fileClassAlias: 'type' } };
  const host = registry ? { plugins: { fileclass: plugin } } : { getPlugin: id => id === 'fileclass' ? plugin : null };
  return { plugin, bridge: new FileclassBridge({ plugins: host }) };
}
for (const registry of [false, true]) test(`read the current Fileclass alias, registry=${registry}`, () => {
  const { plugin, bridge } = fixture(registry);
  assert.equal(bridge.bindingProperty('fileClass'), 'type');
  plugin.settings.fileClassAlias = 'note type';
  assert.equal(bridge.bindingProperty('fileClass'), 'note type');
  assert.deepEqual(plugin.settings, { fileClassAlias: 'note type' });
});
test('only a missing alias uses the legacy fallback', () => {
  const { plugin, bridge } = fixture();
  delete plugin.settings;
  assert.equal(bridge.bindingProperty('legacyType'), 'legacyType');
  plugin.settings = {};
  assert.equal(bridge.bindingProperty('legacyType'), 'legacyType');
  for (const alias of ['', ' ', null, 3, '__proto__', 'prototype', 'constructor']) {
    plugin.settings.fileClassAlias = alias;
    assert.throws(() => bridge.bindingProperty('fileClass'), /alias is invalid/);
  }
});
test('unavailable Fileclass cannot silently use the fallback', () => {
  const { plugin, bridge } = fixture();
  delete plugin.api;
  assert.throws(() => bridge.bindingProperty('fileClass'), /unavailable/);
});
