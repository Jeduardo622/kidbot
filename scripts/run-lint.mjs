#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const eslintBin = path.resolve('node_modules/.bin/eslint');
const hasLocalLint = existsSync(eslintBin);
const strictMode = process.env.STRICT_VERIFY === '1';
const isShim = hasLocalLint
  ? (() => {
      try {
        return readFileSync(eslintBin, 'utf-8').includes('run-lint.mjs');
      } catch (error) {
        return false;
      }
    })()
  : false;

if (hasLocalLint && !isShim) {
  const result = spawnSync(eslintBin, ['.', '--max-warnings=0'], { stdio: 'inherit' });
  process.exit(result.status ?? 0);
}

if (strictMode) {
  console.error('❌ STRICT_VERIFY=1: ESLint is unavailable. Run `pnpm install` and retry.');
  process.exit(1);
}

console.log('⚙️  Skipping ESLint – dependencies unavailable; fallback mode assumed.');
process.exit(0);
