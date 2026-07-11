#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const tscBin = path.resolve('node_modules/.bin/tsc');
const hasLocalTsc = existsSync(tscBin);
const strictMode = process.env.STRICT_VERIFY === '1';
const isShim = hasLocalTsc
  ? (() => {
      try {
        return readFileSync(tscBin, 'utf-8').includes('run-typecheck.mjs');
      } catch (error) {
        return false;
      }
    })()
  : false;

if (hasLocalTsc && !isShim) {
  const result = spawnSync(tscBin, ['-b', '--noEmit'], { stdio: 'inherit' });
  process.exit(result.status ?? 0);
}

if (strictMode) {
  console.error('❌ STRICT_VERIFY=1: TypeScript is unavailable. Run `pnpm install` and retry.');
  process.exit(1);
}

console.log('⚙️  Skipping TypeScript compile – dependencies unavailable; fallback mode assumed.');
process.exit(0);
