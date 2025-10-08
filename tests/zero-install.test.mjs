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
});

test('fixtures align with coloring svg', () => {
  const svg = read('fixtures/coloring/space-cat.svg');
  assert.ok(svg.includes('<svg'));
  assert.ok(svg.includes('stroke-linejoin'));
});

test('science fixture has prediction choices', () => {
  const data = JSON.parse(read('fixtures/science/buoyancy.json'));
  assert.ok(Array.isArray(data.prediction.choices));
  assert.equal(data.prediction.choices.length > 0, true);
});
