#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const rootTestFiles = existsSync('tests')
  ? readdirSync('tests')
      .filter((file) => file.endsWith('.test.mjs'))
      .map((file) => path.join('tests', file))
  : [];

const runRootNodeTests = () => {
  if (rootTestFiles.length === 0) {
    return 0;
  }
  const result = spawnSync(process.execPath, ['--test', ...rootTestFiles], { stdio: 'inherit' });
  return result.status ?? 0;
};

const resolvePathCommand = (name) => {
  const pathValue = process.env.PATH ?? '';
  for (const dir of pathValue.split(path.delimiter)) {
    if (!dir) {
      continue;
    }
    const candidate = path.join(dir, name);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
};

const pnpmPs1 = resolvePathCommand('pnpm.ps1');
const pnpmCandidates = [
  { command: 'pnpm', args: [], label: 'pnpm', shell: false },
  { command: 'pnpm.cmd', args: [], label: 'pnpm.cmd', shell: true },
  ...(pnpmPs1
    ? [
        {
          command: 'powershell.exe',
          args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pnpmPs1],
          label: 'pnpm.ps1',
          shell: false
        }
      ]
    : [])
];
const pnpmCommand = pnpmCandidates.find(
  (candidate) =>
    spawnSync(candidate.command, [...candidate.args, '--version'], {
      shell: candidate.shell,
      stdio: 'ignore',
      timeout: 5_000
    }).status === 0
);
const hasNodeModules = ['node_modules', 'apps/agent-service/node_modules', 'apps/mcp-server/node_modules', 'apps/web-widget/node_modules']
  .some((dir) => existsSync(dir));
const strictMode = process.env.STRICT_VERIFY === '1';

if (pnpmCommand && hasNodeModules) {
  console.log(`🧪 Running full workspace tests via ${pnpmCommand.label} recursive scripts`);
  const result = spawnSync(pnpmCommand.command, [...pnpmCommand.args, '-r', '--if-present', 'run', 'test'], {
    shell: pnpmCommand.shell,
    stdio: 'inherit'
  });
  if ((result.status ?? 0) !== 0) {
    process.exit(result.status ?? 0);
  }
  process.exit(runRootNodeTests());
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
process.exit(runRootNodeTests());
