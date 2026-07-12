import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

import { parseHarnessClassification } from '../scripts/export-harness-classification.mjs';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, '..');

test('accepts only exact router classifications', () => {
  for (const classification of ['review-only', 'standard', 'protected']) {
    assert.equal(parseHarnessClassification(JSON.stringify({ classification })), classification);
  }
});

test('fails closed for malformed, missing, and injection-shaped classification', () => {
  for (const output of [
    '',
    '{',
    '{}',
    JSON.stringify({ classification: 'review-only\nPRODUCTION_TOKEN=stolen' }),
    JSON.stringify({ classification: 'review-only; pnpm run smoke:production-widget-story-panels' }),
    JSON.stringify({ classification: ['review-only'] }),
  ]) assert.throws(() => parseHarnessClassification(output), /classification|JSON|output/i);
});

test('direct router capture is pure JSON accepted by the exporter CLI', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'kidbot-route-capture-'));
  const capturePath = path.join(directory, 'harness-route.json');
  const routed = await execFileAsync(process.execPath, ['./scripts/route-task.mjs', '--json', 'README.md'], { cwd: repoRoot });
  await writeFile(capturePath, routed.stdout);

  const captured = await readFile(capturePath, 'utf8');
  const parsed = JSON.parse(captured);
  assert.equal(parseHarnessClassification(captured), parsed.classification);
  assert.equal(routed.stderr, '');

  const exported = await execFileAsync(process.execPath, ['./scripts/export-harness-classification.mjs', capturePath], { cwd: repoRoot });
  assert.equal(exported.stdout, `HARNESS_CLASSIFICATION=${parsed.classification}\n`);
  assert.equal(exported.stderr, '');
});
