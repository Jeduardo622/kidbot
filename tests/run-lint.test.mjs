import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { runLint } from '../scripts/run-lint.mjs';

const runWith = ({ platform = 'linux', result = { status: 0 } } = {}) => {
  const calls = [];
  const code = runLint({
    cwd: '/repo',
    exists: () => true,
    platform,
    read: () => '',
    spawn: (command, args, options) => {
      calls.push({ command, args, options });
      return result;
    },
  });
  return { calls, code };
};

test('selects the Windows command shim and shell deterministically', () => {
  const { calls, code } = runWith({ platform: 'win32' });
  assert.equal(code, 0);
  assert.equal(calls[0].command, path.resolve('/repo', 'node_modules/.bin/eslint.cmd'));
  assert.equal(calls[0].options.shell, true);
});

test('selects the POSIX executable without a shell', () => {
  const { calls, code } = runWith({ platform: 'linux' });
  assert.equal(code, 0);
  assert.equal(calls[0].command, path.resolve('/repo', 'node_modules/.bin/eslint'));
  assert.equal(calls[0].options.shell, false);
});

test('propagates nonzero ESLint status', () => {
  assert.equal(runWith({ result: { status: 7 } }).code, 7);
});

test('fails closed when spawn has no status', () => {
  assert.equal(runWith({ result: { status: null } }).code, 1);
});

test('fails closed when ESLint cannot start', () => {
  assert.equal(runWith({ result: { error: new Error('spawn failed'), status: null } }).code, 1);
});
