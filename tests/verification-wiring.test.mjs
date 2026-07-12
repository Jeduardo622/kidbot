import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('root tests register tsx and expose a dedicated root-only command', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
  const runner = await readFile('scripts/run-test.mjs', 'utf8');

  assert.equal(packageJson.scripts['test:root'], 'node ./scripts/run-test.mjs --root-only');
  assert.match(runner, /'--import', 'tsx', '--test'/);
  assert.match(runner, /process\.argv\.includes\('--root-only'\)/);
});

test('verify:local is authoritative and remains secret-free', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
  const verifyLocal = packageJson.scripts['verify:local'];
  const strictVerify = packageJson.scripts['verify:local:strict'];
  const lintRunner = await readFile('scripts/run-lint.mjs', 'utf8');
  const typecheckRunner = await readFile('scripts/run-typecheck.mjs', 'utf8');

  assert.equal(verifyLocal, 'cross-env STRICT_VERIFY=1 pnpm run verify:local:strict');
  assert.equal(
    strictVerify,
    'pnpm run lint && pnpm run typecheck && pnpm run test && pnpm --filter @kidbot/mcp-server run test:compat && pnpm run smoke:provider-preflight:ci && pnpm run smoke:secured-posture',
  );
  assert.match(lintRunner, /process\.env\.STRICT_VERIFY === '1'/);
  assert.match(typecheckRunner, /process\.env\.STRICT_VERIFY === '1'/);
  assert.doesNotMatch(strictVerify, /production|railway|OPENAI_API_KEY|KIDBOT_REMOTE_MCP_URL/);
});

test('test:all delegates root test discovery to test:root', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));

  assert.match(packageJson.scripts['test:all'], /pnpm run test:root/);
  assert.doesNotMatch(packageJson.scripts['test:all'], /tests\/[^ ]+\.test\.mjs/);
});

test('CI delegates root smoke-script tests to verify-change', async () => {
  const workflow = await readFile('.github/workflows/ci.yml', 'utf8');

  assert.match(workflow, /name: Verify engineering change\s+run: pnpm run verify-change/);
  assert.doesNotMatch(workflow, /name: Run root smoke-script tests/);
});

test('CI keeps specialist recommendations advisory-only', async () => {
  const workflow = await readFile('.github/workflows/ci.yml', 'utf8');

  assert.match(workflow, /HARNESS_ROUTE_REPORT="\$RUNNER_TEMP\/harness-route\.json"/);
  assert.match(workflow, /cat "\$HARNESS_ROUTE_REPORT"/);
  assert.doesNotMatch(workflow, /spawn[^\n]*specialist|specialist[^\n]*(?:spawn|execute|dispatch)/i);
  assert.doesNotMatch(workflow, /required[^\n]*specialist[^\n]*artifact|specialist[^\n]*artifact[^\n]*required/i);
});

test('MCP compatibility verification builds its required dist artifact first', async () => {
  const packageJson = JSON.parse(await readFile('apps/mcp-server/package.json', 'utf8'));

  assert.equal(packageJson.scripts['test:compat'], 'pnpm run build && node --test test/mcp-compat.test.mjs');
});

test('secured posture verification builds its required agent-service artifact first', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));

  assert.equal(
    packageJson.scripts['smoke:secured-posture'],
    'pnpm --filter @kidbot/agent-service run build && node ./scripts/smoke-secured-posture.mjs',
  );
});

test('typed linting uses a project that includes every linted TypeScript surface', async () => {
  const eslintConfig = await readFile('eslint.config.js', 'utf8');
  const lintProject = JSON.parse(await readFile('tsconfig.eslint.json', 'utf8'));

  assert.match(eslintConfig, /project:\s*['"]\.\/tsconfig\.eslint\.json['"]/);
  assert.deepEqual(lintProject.include, [
    'apps/**/*.ts',
    'apps/**/*.tsx',
    'scripts/**/*.ts',
    'scripts/**/*.tsx',
  ]);
});

test('lint runner exposes injectable behavior and fails closed without an exit status', async () => {
  const lintRunner = await readFile('scripts/run-lint.mjs', 'utf8');

  assert.match(lintRunner, /export const runLint/);
  assert.match(lintRunner, /eslint\.cmd/);
  assert.doesNotMatch(lintRunner, /result\.status \?\? 0/);
  assert.match(lintRunner, /result\.error/);
});

test('lint policy does not broadly suppress promise or underscore-variable findings', async () => {
  const eslintConfig = await readFile('eslint.config.js', 'utf8');

  assert.doesNotMatch(eslintConfig, /varsIgnorePattern/);
  assert.doesNotMatch(eslintConfig, /apps\/mcp-server\/src\/server\.ts/);
  assert.match(eslintConfig, /ignoreRestSiblings:\s*true/);
});
