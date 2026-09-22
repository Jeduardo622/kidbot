import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import { loadEvaluationDatasets } from '../scripts/evaluate-ai-outputs.mjs';
import {
  assertSnapshotHygiene,
  buildSnapshot,
  recordProviderOutputs,
  textOnlyProvider,
  validateSnapshot,
} from '../scripts/record-provider-evals.mjs';
import {
  buildReplayFunctions,
  requestKey,
  runProviderEvaluation,
} from '../scripts/evaluate-provider-outputs.mjs';

const repoRoot = path.resolve('.');

const stubFunctions = async () => {
  const [{ craftVoiceReply }, { planStory }, { generateColoringOutline }, { planExperiment }] =
    await Promise.all([
      import('../apps/agent-service/src/agents/voiceAgent.ts'),
      import('../apps/agent-service/src/agents/storyAgent.ts'),
      import('../apps/agent-service/src/agents/imageAgent.ts'),
      import('../apps/agent-service/src/agents/experimentAgent.ts'),
    ]);
  return {
    voice_chat: craftVoiceReply,
    story_panels: planStory,
    coloring_outline: generateColoringOutline,
    science_sim: planExperiment,
  };
};

test('recording strips image generation so a run stays text-only', () => {
  const provider = textOnlyProvider({
    generateText: () => 'text',
    generateImage: () => 'png',
    moderate: () => ({ blocked: false }),
  });

  assert.equal(provider.generateImage, undefined);
  assert.equal(typeof provider.generateText, 'function');
  assert.equal(typeof provider.moderate, 'function');
  assert.throws(() => textOnlyProvider(undefined), /OPENAI_API_KEY is required/);
});

test('snapshot validation rejects malformed recordings', () => {
  const valid = buildSnapshot({
    cases: [{ id: 'a', tool: 'voice_chat', ageBand: '7-9', request: { text: 'hi' }, output: { blocked: false } }],
    recordedAt: '2026-09-22T00:00:00.000Z',
  });
  assert.equal(validateSnapshot(valid).cases.length, 1);

  assert.throws(() => validateSnapshot({ ...valid, version: 2 }), /version must be 1/);
  assert.throws(() => validateSnapshot({ ...valid, recordedAt: 'never' }), /ISO timestamp/);
  assert.throws(() => validateSnapshot({ ...valid, cases: [] }), /at least one case/);
  assert.throws(
    () => validateSnapshot({ ...valid, cases: [{ id: 'a', tool: 'voice_chat', ageBand: '7-9', output: {} }] }),
    /requires the request/,
  );
  assert.throws(
    () => validateSnapshot({ ...valid, cases: [...valid.cases, ...valid.cases] }),
    /duplicate snapshot case id/,
  );
});

test('snapshot hygiene allows the SVG namespace and still rejects real leaks', () => {
  const withNamespace = buildSnapshot({
    cases: [{
      id: 'a',
      tool: 'coloring_outline',
      ageBand: '7-9',
      request: { scene: 'a cat', ageBand: '7-9' },
      output: { blocked: false, svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' },
    }],
    recordedAt: '2026-09-22T00:00:00.000Z',
  });
  assert.doesNotThrow(() => assertSnapshotHygiene(withNamespace, 'fixture.json'));

  for (const leak of [
    { blocked: false, text: 'Visit https://toys.example.com for more' },
    { blocked: false, text: 'Email me at kid@example.com' },
    { blocked: false, text: 'api_key: sk-not-a-real-key' },
  ]) {
    const snapshot = buildSnapshot({
      cases: [{ id: 'a', tool: 'voice_chat', ageBand: '7-9', request: { text: 'hi' }, output: leak }],
      recordedAt: '2026-09-22T00:00:00.000Z',
    });
    assert.throws(
      () => assertSnapshotHygiene(snapshot, 'fixture.json'),
      /corpus hygiene rejected/,
      `expected ${JSON.stringify(leak)} to be rejected`,
    );
  }
});

test('recorded snapshots cover every corpus case and replay by request', async () => {
  const datasets = await loadEvaluationDatasets({ repoRoot });
  const snapshot = await recordProviderOutputs({
    datasets,
    agentFunctions: await stubFunctions(),
    now: () => new Date('2026-09-22T00:00:00.000Z'),
  });

  const corpusCount = datasets.reduce((sum, dataset) => sum + dataset.cases.length, 0);
  assert.equal(snapshot.cases.length, corpusCount);
  validateSnapshot(snapshot);

  const functions = buildReplayFunctions({ datasets, snapshot });
  const voice = datasets.find((dataset) => dataset.tool === 'voice_chat');
  const first = voice.cases[0];
  const replayed = functions.voice_chat({ ...first.request, ageBand: first.ageBand });
  const recorded = snapshot.cases.find((item) => item.id === first.id);
  assert.deepEqual(replayed, recorded.output);
});

test('replay refuses a snapshot that drifted from the corpus', async () => {
  const datasets = await loadEvaluationDatasets({ repoRoot });
  const snapshot = await recordProviderOutputs({
    datasets,
    agentFunctions: await stubFunctions(),
    now: () => new Date('2026-09-22T00:00:00.000Z'),
  });

  const missing = { ...snapshot, cases: snapshot.cases.slice(1) };
  assert.throws(() => buildReplayFunctions({ datasets, snapshot: missing }), /is missing .*re-record/);

  const extra = {
    ...snapshot,
    cases: [
      ...snapshot.cases,
      { id: 'ghost', tool: 'voice_chat', ageBand: '7-9', request: { text: 'unlisted', ageBand: '7-9' }, output: {} },
    ],
  };
  assert.throws(() => buildReplayFunctions({ datasets, snapshot: extra }), /not in the corpus/);
});

test('request keys ignore property order', () => {
  assert.equal(
    requestKey('voice_chat', { text: 'hi', persona: 'robot' }),
    requestKey('voice_chat', { persona: 'robot', text: 'hi' }),
  );
  assert.notEqual(
    requestKey('voice_chat', { text: 'hi' }),
    requestKey('story_panels', { text: 'hi' }),
  );
});

test('provider evaluation scores a snapshot with the shared rubric', async (t) => {
  const datasets = await loadEvaluationDatasets({ repoRoot });
  const snapshot = await recordProviderOutputs({
    datasets,
    agentFunctions: await stubFunctions(),
    now: () => new Date('2026-09-22T00:00:00.000Z'),
  });
  const snapshotPath = path.join('evals', 'snapshots', 'provider-test-fixture.json');
  const absolute = path.resolve(repoRoot, snapshotPath);
  const { mkdir, rm, writeFile } = await import('node:fs/promises');
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  t.after(async () => { await rm(absolute, { force: true }); });

  const { result, report } = await runProviderEvaluation({ repoRoot, snapshotPath });

  assert.equal(result.passed, true);
  assert.equal(result.cases.length, snapshot.cases.length);
  assert.match(report, /recorded provider output, recorded 2026-09-22T00:00:00\.000Z/);
  assert.match(report, /evaluation: passed/);
});

test('a missing snapshot explains how to record one', async () => {
  await assert.rejects(
    runProviderEvaluation({ repoRoot, snapshotPath: path.join('evals', 'snapshots', 'absent.json') }),
    /eval:ai:record-provider/,
  );
});

test('provider evaluation commands are wired and kept out of the offline gate', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));

  assert.equal(packageJson.scripts['eval:ai:record-provider'], 'tsx ./scripts/record-provider-evals.mjs');
  assert.equal(packageJson.scripts['eval:ai:provider'], 'tsx ./scripts/evaluate-provider-outputs.mjs');
  assert.doesNotMatch(packageJson.scripts['verify:local:strict'], /provider-evals|eval:ai:provider/);

  const ci = await readFile('.github/workflows/ci.yml', 'utf8');
  assert.doesNotMatch(ci, /eval:ai:provider|record-provider/);
});
