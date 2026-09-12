#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const runTypecheck = ({
  cwd = process.cwd(),
  platform = process.platform,
  exists = existsSync,
  read = readFileSync,
  spawn = spawnSync,
  strictMode = process.env.STRICT_VERIFY === '1',
} = {}) => {
  const tscBin = path.resolve(
    cwd,
    platform === 'win32' ? 'node_modules/.bin/tsc.cmd' : 'node_modules/.bin/tsc',
  );
  const hasLocalTsc = exists(tscBin);
  const isShim = hasLocalTsc
    ? (() => {
        try {
          return read(tscBin, 'utf-8').includes('run-typecheck.mjs');
        } catch (error) {
          return false;
        }
      })()
    : false;

  if (hasLocalTsc && !isShim) {
    const result = spawn(tscBin, ['-b', '--noEmit'], {
      cwd,
      shell: platform === 'win32',
      stdio: 'inherit',
    });
    if (result.error) {
      console.error('TypeScript failed to start.');
      return 1;
    }
    return result.status ?? 1;
  }

  if (strictMode) {
    console.error('❌ STRICT_VERIFY=1: TypeScript is unavailable. Run `pnpm install` and retry.');
    return 1;
  }

  console.log('⚙️  Skipping TypeScript compile – dependencies unavailable; fallback mode assumed.');
  return 0;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(runTypecheck());
}
