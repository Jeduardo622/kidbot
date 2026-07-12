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
  assert.match(instructions, /specialist recommendations.*advisory/i);
  assert.match(instructions, /do not spawn agents/i);
  assert.match(instructions, /do not count as approval/i);
});

test('package exposes routing and verification commands', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));

  assert.equal(packageJson.scripts['route-task'], 'node ./scripts/route-task.mjs');
  assert.equal(packageJson.scripts['verify-change'], 'node ./scripts/verify-change.mjs');
  assert.ok(packageJson.scripts['verify:local']);
  assert.equal(packageJson.scripts['test:harness'], 'node --import tsx --test tests/ai-output-evaluator.test.mjs tests/engineering-policy.test.mjs tests/route-task.test.mjs tests/verify-change.test.mjs tests/specialist-routing.test.mjs tests/resolve-harness-base.test.mjs tests/export-harness-classification.test.mjs tests/engineering-harness-wiring.test.mjs tests/verification-wiring.test.mjs tests/run-lint.test.mjs');
});

test('repository docs define deterministic evaluator thresholds and limitations', async () => {
  const instructions = await readFile('AGENTS.md', 'utf8');
  const readme = await readFile('README.md', 'utf8');
  for (const document of [instructions, readme]) {
    assert.match(document, /eval:ai/);
    assert.match(document, /case.*85.*tool mean.*90.*overall mean.*90/is);
    assert.match(document, /contract.*safety.*hard failure/is);
    assert.match(document, /age-proxy.*deterministic proxy/is);
    assert.match(document, /no-provider/i);
    assert.match(document, /output.*symlink/i);
    assert.match(document, /output.*direct child file.*repository root.*operating-system temporary directory/is);
    assert.match(document, /dev.*ino.*before.*temporary.*after.*rename/is);
    assert.match(document, /authorized malicious local actor.*after the final check.*outside.*no-secret report threat model/is);
    assert.doesNotMatch(document, /replaced (?:or )?linked parents are rejected/i);
  }
});

test('README documents text and JSON specialist recommendations as advisory output', async () => {
  const readme = await readFile('README.md', 'utf8');

  assert.match(readme, /specialist:\s*tester.*specialist:\s*ui-hardener/is);
  assert.match(readme, /"specialists"\s*:\s*\[/);
  assert.match(readme, /CI only logs recommendations/i);
});

test('CODEOWNERS requires the repository owner on protected governance surfaces', async () => {
  const owners = await readFile('.github/CODEOWNERS', 'utf8');
  for (const pattern of ['/.agents/', '/AGENTS.md', '/.github/workflows/', '/scripts/', '/apps/agent-service/', '/apps/mcp-server/']) {
    assert.match(owners, new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '.*@Jeduardo622'));
  }
});

test('CI resolves a safe Git base and enforces routing and verification', async () => {
  const workflow = await readFile('.github/workflows/ci.yml', 'utf8');

  assert.match(workflow, /fetch-depth:\s*0/);
  assert.match(workflow, /EVENT_NAME:\s*\$\{\{ github\.event_name \}\}/);
  assert.match(workflow, /BASE_REF:\s*\$\{\{ github\.base_ref \}\}/);
  assert.match(workflow, /BEFORE_SHA:\s*\$\{\{ github\.event\.before \}\}/);
  assert.match(workflow, /node scripts\/resolve-harness-base\.mjs/);
  assert.doesNotMatch(workflow, /run:\s*\|[^]*\$\{\{ github\./);
  assert.match(workflow, /HARNESS_BASE/);
  assert.match(workflow, /HARNESS_ROUTE_REPORT="\$RUNNER_TEMP\/harness-route\.json"/);
  assert.match(workflow, /node \.\/scripts\/route-task\.mjs --base "\$HARNESS_BASE" --json > "\$HARNESS_ROUTE_REPORT"/);
  assert.doesNotMatch(workflow, /pnpm run route-task[^\n]*>/);
  assert.doesNotMatch(workflow, /> harness-route\.json/);
  assert.match(workflow, /cat "\$HARNESS_ROUTE_REPORT"/);
  assert.match(workflow, /node scripts\/export-harness-classification\.mjs "\$HARNESS_ROUTE_REPORT" >> "\$GITHUB_ENV"/);
  assert.match(workflow, /if: env\.HARNESS_CLASSIFICATION == 'review-only'\s+run: pnpm run verify:local/);
  assert.equal((workflow.match(/run: pnpm run verify:local/g) || []).length, 1);
  assert.match(workflow, /name: Verify engineering change\s+run: pnpm run verify-change/);
  assert.doesNotMatch(workflow, /if: env\.HARNESS_CLASSIFICATION != 'review-only'/);
  assert.match(workflow, /pnpm run verify-change -- --base "\$HARNESS_BASE"/);
  assert.doesNotMatch(workflow, /pnpm run smoke:(?:production|railway)/);
  for (const duplicatedStep of [
    'name: Typecheck',
    'name: Run root smoke-script tests',
    'name: Test web-widget',
    'name: Run MCP compatibility tests',
  ]) assert.doesNotMatch(workflow, new RegExp(duplicatedStep));
  assert.doesNotMatch(workflow, /name: Build agent-service/);
  assert.match(workflow, /name: Test agent-service with Redis limiter smoke[^]*RATE_LIMIT_STORE: redis/);
  assert.match(workflow, /name: Run parent store Redis deploy smoke/);
  assert.match(workflow, /name: Run MCP auth\/startup matrix/);
  assert.doesNotMatch(workflow, /spawn[^\n]*specialist|specialist[^\n]*(?:spawn|execute|dispatch)/i);
  assert.doesNotMatch(workflow, /required[^\n]*specialist[^\n]*artifact|specialist[^\n]*artifact[^\n]*required/i);
  assert.doesNotMatch(workflow, /openai|anthropic|gemini|provider[^\n]*orchestrat/i);
});

test('agent service retains service documentation ownership', async () => {
  const serviceInstructions = await readFile('apps/agent-service/AGENT.md', 'utf8');

  assert.match(serviceInstructions, /Kidbot Agent Service/);
  assert.match(serviceInstructions, /POST \/story-panels/);
});
