import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();

const read = (relative) => readFileSync(path.join(projectRoot, relative), 'utf-8');

['apps/web-widget/dist/kidbot-fallback.html', 'apps/web-widget/dist/kidbot-fallback.js', 'apps/web-widget/dist/kidbot-fallback.css']
  .forEach((file) => {
    test(`fallback asset present: ${file}`, () => {
      assert.ok(existsSync(path.join(projectRoot, file)), `${file} should exist`);
    });
  });

test('fixtures align with fallback voice', () => {
  const fixture = JSON.parse(read('fixtures/voice/moon.json'));
  assert.equal(fixture.blocked, false);
  assert.ok(fixture.text.includes('Moon'));
  assert.equal(fixture.source, 'fixture');
});

test('fixtures align with coloring svg', () => {
  const svg = read('fixtures/coloring/space-cat.svg');
  assert.ok(svg.includes('<svg'));
  assert.ok(svg.includes('stroke-linejoin'));
  assert.ok(!svg.match(/<image\s/i));
});

test('science fixture has prediction choices', () => {
  const data = JSON.parse(read('fixtures/science/buoyancy.json'));
  assert.ok(Array.isArray(data.prediction.choices));
  assert.equal(data.prediction.choices.length > 0, true);
  assert.equal(typeof data.supervision, 'string');
});

test('fallback html exposes required panels and controls', () => {
  const html = read('apps/web-widget/dist/kidbot-fallback.html');
  ['kb-voice', 'kb-comics', 'kb-coloring', 'kb-science'].forEach((id) => {
    assert.ok(html.includes(`id="${id}"`), `Expected ${id} section in fallback html`);
  });
  ['kb-voice-send', 'kb-comic-generate', 'kb-color-generate', 'kb-sci-generate'].forEach((id) => {
    assert.ok(html.includes(`id="${id}`), `Expected control ${id} in fallback html`);
  });
});

test('fallback javascript references fixtures and Apps SDK hooks', () => {
  const js = read('apps/web-widget/dist/kidbot-fallback.js');
  ['/fixtures/voice/moon.json', '/fixtures/comics/dragon4.json', '/fixtures/coloring/space-cat.svg', '/fixtures/science/buoyancy.json'].forEach((ref) => {
    assert.ok(js.includes(ref), `Expected ${ref} reference in fallback js`);
  });
  ['window.openai?.callTool', 'window.openai?.setWidgetState', 'window.openai?.requestDisplayMode'].forEach((hook) => {
    assert.ok(js.includes(hook), `Expected ${hook} interop in fallback js`);
  });
});

test('fallback styles provide tab affordances', () => {
  const css = read('apps/web-widget/dist/kidbot-fallback.css');
  ['.kb-tab', '.kb-tab--active', '.kb-panel', '.kb-panel--active', '.kb-grid'].forEach((className) => {
    assert.ok(css.includes(className), `Expected ${className} styles in fallback css`);
  });
});
