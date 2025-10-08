#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const hasPnpm = spawnSync('pnpm', ['--version'], { stdio: 'ignore' }).status === 0;
const hasNodeModules = ['node_modules', 'apps/agent-service/node_modules', 'apps/mcp-server/node_modules', 'apps/web-widget/node_modules']
  .some((dir) => existsSync(dir));

if (hasPnpm && hasNodeModules) {
  const result = spawnSync('pnpm', ['-r', 'test'], { stdio: 'inherit' });
  process.exit(result.status ?? 0);
}

console.log('⚙️  Running zero-install smoke tests with Node test runner');
const fallback = spawnSync(process.execPath, ['--test', 'tests/zero-install.test.mjs'], { stdio: 'inherit' });
process.exit(fallback.status ?? 0);
