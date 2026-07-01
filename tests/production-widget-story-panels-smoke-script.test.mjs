import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('production widget story panels smoke is wired as a package script', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));

  assert.equal(
    packageJson.scripts['smoke:production-widget-story-panels'],
    'tsx ./scripts/smoke-production-widget-story-panels.tsx',
  );
});

test('production widget story panels workflow uses protected remote MCP URL secret', async () => {
  const workflow = await readFile('.github/workflows/production-widget-story-panels-smoke.yml', 'utf8');

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /environment:\s*production/);
  assert.match(workflow, /secrets\.KIDBOT_REMOTE_MCP_URL/);
  assert.match(workflow, /pnpm run smoke:production-widget-story-panels/);
});
