import assert from 'node:assert/strict';

export const devices = [
  { name: 'desktop mouse', mobile: false, coarse: false, height: '' },
  { name: 'Obsidian mobile without coarse-pointer signal', mobile: true, coarse: false, height: '44px' },
  { name: 'desktop with a coarse pointer', mobile: false, coarse: true, height: '44px' },
];

export function expectSuggestionStyle(el, device, stacked = false) {
  assert.equal(el.style.minHeight, device.height);
  assert.equal(el.style.boxSizing, 'border-box');
  assert.equal(el.style.display, 'flex');
  assert.equal(el.style.flexDirection, stacked ? 'column' : 'row');
  assert.equal(el.style.alignItems, stacked ? 'stretch' : 'center');
  if (stacked) assert.equal(el.style.justifyContent, 'center');
}

export function expectClassIcon(el) {
  assert.equal(el.attributes['aria-hidden'], 'true');
  assert.equal(el.style.display, 'inline-flex');
  assert.equal(el.style.alignItems, 'center');
  assert.equal(el.style.justifyContent, 'center');
  assert.equal(el.style.flexShrink, '0');
  assert.equal(el.style.lineHeight, '1');
  assert.equal(el.style['--icon-size'], 'var(--icon-m, 18px)');
}

export function pointerDocument(coarse, queries = []) {
  return { defaultView: { matchMedia(query) {
    queries.push(query);
    assert.equal(query, '(any-pointer: coarse)');
    return { matches: coarse };
  } } };
}
