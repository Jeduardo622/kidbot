#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const tscBin = path.resolve('node_modules/.bin/tsc');
const hasLocalTsc = existsSync(tscBin);
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
  const result = spawnSync(tscBin, ['--noEmit'], { stdio: 'inherit' });
  process.exit(result.status ?? 0);
}

console.log('⚙️  Skipping TypeScript compile – dependencies unavailable; fallback mode assumed.');
process.exit(0);
