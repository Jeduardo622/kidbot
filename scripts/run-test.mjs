#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const pnpmCommand = ['pnpm', 'pnpm.cmd'].find((command) => spawnSync(command, ['--version'], { stdio: 'ignore' }).status === 0);
const hasNodeModules = ['node_modules', 'apps/agent-service/node_modules', 'apps/mcp-server/node_modules', 'apps/web-widget/node_modules']
  .some((dir) => existsSync(dir));
const strictMode = process.env.STRICT_VERIFY === '1';

if (pnpmCommand && hasNodeModules) {
  console.log('🧪 Running full workspace tests via pnpm recursive scripts');
  const result = spawnSync(pnpmCommand, ['-r', '--if-present', 'run', 'test', '--', '--run'], { stdio: 'inherit' });
  process.exit(result.status ?? 0);
}

const reasons = [
  !pnpmCommand ? 'pnpm executable was not found by Node child process' : null,
  !hasNodeModules ? 'workspace dependencies are not installed' : null
].filter(Boolean);

if (strictMode) {
  console.error(`❌ STRICT_VERIFY=1: full verification unavailable (${reasons.join('; ')}).`);
  console.error('Run `pnpm install` and retry, or unset STRICT_VERIFY for smoke-only fallback.');
  process.exit(1);
}

console.warn(`⚠️  Full workspace tests unavailable (${reasons.join('; ')}).`);
console.warn('⚠️  Running smoke-only fallback. This is non-authoritative and does not run package Vitest suites.');
const fallback = spawnSync(process.execPath, ['--test', 'tests/zero-install.test.mjs'], { stdio: 'inherit' });
process.exit(fallback.status ?? 0);
