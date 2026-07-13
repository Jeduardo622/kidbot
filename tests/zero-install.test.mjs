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

test('package manager pin matches CI pnpm version', () => {
  const packageJson = JSON.parse(read('package.json'));
  const workflow = read('.github/workflows/ci.yml');
  const workflowPnpmVersion = workflow.match(/version:\s*([0-9]+\.[0-9]+\.[0-9]+)/)?.[1];

  assert.equal(packageJson.packageManager, `pnpm@${workflowPnpmVersion}`);
});

test('pnpm run smoke preflight stays zero-install locally', () => {
  const workspace = read('pnpm-workspace.yaml');

  assert.match(workspace, /^verifyDepsBeforeRun:\s*false$/m);
});

test('pnpm permits only the esbuild dependency build', () => {
  const workspace = read('pnpm-workspace.yaml');
  const block = workspace.match(/^allowBuilds:\s*\r?\n((?:^[ \t]+.*(?:\r?\n|$))*)/m)?.[1];
  const allowBuilds = Object.fromEntries(
    (block ?? '').split(/\r?\n/).filter((line) => line.trim()).map((line) => {
      const match = line.match(/^\s+([^:]+):\s*(true|false)\s*$/);
      assert.ok(match, `invalid allowBuilds entry: ${line}`);
      return [match[1], match[2] === 'true'];
    }),
  );

  assert.deepEqual(allowBuilds, { esbuild: true });
});
