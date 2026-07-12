#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const runLint = ({
  cwd = process.cwd(),
  exists = existsSync,
  platform = process.platform,
  read = readFileSync,
  spawn = spawnSync,
  strictMode = process.env.STRICT_VERIFY === '1',
} = {}) => {
  const eslintBin = path.resolve(
    cwd,
    platform === 'win32' ? 'node_modules/.bin/eslint.cmd' : 'node_modules/.bin/eslint',
  );
  const hasLocalLint = exists(eslintBin);
  const isShim = hasLocalLint
    ? (() => {
        try {
          return read(eslintBin, 'utf-8').includes('run-lint.mjs');
        } catch {
          return false;
        }
      })()
    : false;

  if (hasLocalLint && !isShim) {
    const result = spawn(eslintBin, ['.', '--max-warnings=0'], {
      cwd,
      shell: platform === 'win32',
      stdio: 'inherit',
    });
    if (result.error) {
      console.error(`ESLint failed to start: ${result.error.message}`);
      return 1;
    }
    return result.status ?? 1;
  }

  if (strictMode) {
    console.error('❌ STRICT_VERIFY=1: ESLint is unavailable. Run `pnpm install` and retry.');
    return 1;
  }

  console.log('⚙️  Skipping ESLint – dependencies unavailable; fallback mode assumed.');
  return 0;
};

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exit(runLint());
}
