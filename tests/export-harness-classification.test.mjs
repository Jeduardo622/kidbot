import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseHarnessClassification } from '../scripts/export-harness-classification.mjs';

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
