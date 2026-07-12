import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

import { resolveHarnessBase } from '../scripts/resolve-harness-base.mjs';

const execFileAsync = promisify(execFile);
const zeroSha = '0000000000000000000000000000000000000000';

async function repository() {
  const root = await mkdtemp(path.join(tmpdir(), 'kidbot-harness-base-'));
  await execFileAsync('git', ['init'], { cwd: root });
  await execFileAsync('git', ['commit', '--allow-empty', '-m', 'base'], {
    cwd: root,
    env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' },
  });
  await execFileAsync('git', ['update-ref', 'refs/remotes/origin/master', 'HEAD'], { cwd: root });
  return root;
}

test('selects and verifies PR and push bases', async () => {
  const repoRoot = await repository();
  assert.equal(await resolveHarnessBase({ repoRoot, eventName: 'pull_request', baseRef: 'master', before: '' }), 'origin/master');
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot });
  const sha = stdout.trim();
  assert.equal(await resolveHarnessBase({ repoRoot, eventName: 'push', baseRef: '', before: sha }), sha);
});

test('fails closed for empty, zero, unsafe, and unavailable bases', async () => {
  const repoRoot = await repository();
  for (const input of [
    { eventName: 'push', before: '' },
    { eventName: 'push', before: zeroSha },
    { eventName: 'pull_request', baseRef: 'main; echo unsafe' },
    { eventName: 'pull_request', baseRef: 'missing-ref' },
  ]) {
    await assert.rejects(resolveHarnessBase({ repoRoot, baseRef: '', before: '', ...input }), /base|ref|resolve|unsafe/i);
  }
});
