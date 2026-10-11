import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const ci = await read('.github/workflows/ci.yml');
const release = await read('.github/workflows/release.yml');
const config = JSON.parse(await read('release-please-config.json'));
const baseline = JSON.parse(await read('.release-please-manifest.json'));
const pkg = JSON.parse(await read('package.json'));

test('both workflows run the same metadata, type, test, and build checks', () => {
  assert.equal(pkg.scripts.check, 'npm run validate:metadata && npm run typecheck && npm test && npm run build');
  for (const workflow of [ci, release]) {
    assert.match(workflow, /npm ci/);
    assert.match(workflow, /npm run check/);
    assert.match(workflow, /persist-credentials: false/);
    assert.doesNotMatch(workflow, /releases\//);
  }
});

test('Release Please is the only publication path and builds before tagging', () => {
  assert.match(ci, /  pull_request:/);
  assert.doesNotMatch(ci, /gh release|  push:/);
  assert.match(release, /push:\n    branches: \[main\]/);
  assert.match(release, /if: github.ref == 'refs\/heads\/main'/);
  assert.match(release, /cancel-in-progress: false/);
  assert.ok(release.indexOf('npm run check') < release.indexOf('googleapis/release-please-action@v5'));
  assert.match(release, /if: \$\{\{ steps\.release\.outputs\.release_created \}\}/);
  assert.match(release, /test "\$VERSION" = "\$TAG"/);
  assert.ok(release.includes('BUILT_SHA: ${{ github.sha }}'));
  assert.ok(release.includes('test "$(gh api "repos/$GH_REPO/commits/$TAG" --jq .sha)" = "$BUILT_SHA"'));
  assert.match(release, /test -s dist\/main.js/);
  assert.match(release, /test -s dist\/manifest.json/);
  assert.match(release, /--json isDraft/);
  assert.match(release, /--json body/);
  assert.match(release, /files=\(dist\/main.js dist\/manifest.json\)/);
  assert.match(release, /gh release upload "\$TAG" "\$\{files\[@\]\}"/);
  assert.ok(release.indexOf('gh release upload') < release.indexOf('gh release edit'));
  assert.match(release, /gh release edit "\$TAG" --draft=false/);
  assert.doesNotMatch(release, /--clobber|git tag/);
});

test('Release Please manages Node versions, changelog, and Obsidian manifest', () => {
  assert.equal(config['release-type'], 'node');
  assert.equal(config['bump-minor-pre-major'], true);
  assert.equal(config['include-component-in-tag'], false);
  assert.equal(config['include-v-in-tag'], false);
  assert.equal(config.draft, true);
  assert.equal(config['force-tag-creation'], true);
  assert.deepEqual(config.packages['.']['extra-files'], [
    { type: 'json', path: 'manifest.json', jsonpath: '$.version' },
  ]);
  // The baseline tracks releases, not the candidate version in a release PR.
  assert.match(baseline['.'], /^\d+\.\d+\.\d+$/);
});
