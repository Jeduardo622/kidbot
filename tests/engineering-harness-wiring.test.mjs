import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('repository instructions enforce the engineering harness', async () => {
  const instructions = await readFile('AGENTS.md', 'utf8');

  assert.match(instructions, /read .*instructions/i);
  assert.match(instructions, /route-task.*before implementation/is);
  assert.match(instructions, /stop.*unresolved scope/is);
  assert.match(instructions, /protected.*contain/is);
  assert.match(instructions, /verify-change.*before final/i);
  assert.match(instructions, /executed.*skipped.*blocked.*secret-dependent/is);
});

test('package exposes routing and verification commands', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));

  assert.equal(packageJson.scripts['route-task'], 'node ./scripts/route-task.mjs');
  assert.equal(packageJson.scripts['verify-change'], 'node ./scripts/verify-change.mjs');
  assert.ok(packageJson.scripts['verify:local']);
});

test('CI resolves a safe Git base and enforces routing and verification', async () => {
  const workflow = await readFile('.github/workflows/ci.yml', 'utf8');

  assert.match(workflow, /fetch-depth:\s*0/);
  assert.match(workflow, /origin\/\$\{\{ github\.base_ref \}\}/);
  assert.match(workflow, /\$\{\{ github\.event\.before \}\}/);
  assert.match(workflow, /0{40}/);
  assert.match(workflow, /git (?:rev-parse|cat-file)[^\n]+/);
  assert.match(workflow, /HARNESS_BASE/);
  assert.match(workflow, /pnpm run route-task -- --base "\$HARNESS_BASE" --json/);
  assert.match(workflow, /pnpm run verify-change -- --base "\$HARNESS_BASE"/);
  assert.doesNotMatch(workflow, /pnpm run smoke:(?:production|railway)/);
});

test('agent service retains service documentation ownership', async () => {
  const serviceInstructions = await readFile('apps/agent-service/AGENT.md', 'utf8');

  assert.match(serviceInstructions, /Kidbot Agent Service/);
  assert.match(serviceInstructions, /POST \/story-panels/);
});
