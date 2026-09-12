import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { runTypecheck } from '../scripts/run-typecheck.mjs';

test('typecheck launches the Windows command shim with a shell', () => {
  let invocation;
  assert.equal(
    runTypecheck({
      platform: 'win32',
      cwd: process.cwd(),
      exists: () => true,
      read: () => '',
      spawn: (...args) => {
        invocation = args;
        return { status: 0 };
      },
    }),
    0,
  );
  assert.equal(invocation[0], path.resolve('node_modules/.bin/tsc.cmd'));
  assert.equal(invocation[2].shell, true);
});
test('typecheck fails closed when the compiler cannot start or has no exit status', () => {
  for (const result of [
    { status: null, error: new Error('synthetic spawn failure') },
    { status: null },
    { status: 2 },
  ]) {
    assert.notEqual(runTypecheck({ exists: () => true, read: () => '', spawn: () => result }), 0);
  }
});
test('strict typecheck never silently skips missing dependencies', () => {
  assert.equal(runTypecheck({ exists: () => false, strictMode: true }), 1);
});
