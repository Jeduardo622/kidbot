#!/usr/bin/env node
/**
 * Record real model output for the evaluation corpus.
 *
 * The deterministic evaluator scores the stub renderer, so it proves the
 * response *contract* and nothing about what a child is actually told. This
 * records one live provider response per case into a snapshot that
 * `evaluate-provider-outputs.mjs` scores with the same rubric, which is what
 * turns the eval gate into a measurement of the model.
 *
 * Text only: the provider handed to the story agent deliberately omits
 * `generateImage`, so a recording run never spends image credits and the
 * recorded panels keep the null `imageUrl` the corpus expects.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { assertCorpusHygiene, loadEvaluationDatasets } from './evaluate-ai-outputs.mjs';

export const snapshotVersion = 1;
export const defaultSnapshotPath = path.join('evals', 'snapshots', 'provider-latest.json');

/** Strip image generation so recording stays a text-only, low-cost run. */
export const textOnlyProvider = (provider) => {
  if (!provider) {
    throw new Error('OPENAI_API_KEY is required to record provider evaluations.');
  }
  const { generateImage, ...rest } = provider;
  void generateImage;
  return rest;
};

/**
 * Corpus hygiene rejects any external URL, which is what we want for anything
 * a child could be shown — but a coloring outline legitimately carries the SVG
 * XML namespace. Neutralise only that, so every other URL, address, or key in
 * recorded output still fails the check.
 */
export const hygieneView = (snapshot) =>
  JSON.parse(
    // Backslash is excluded so the replacement never eats a JSON string escape.
    JSON.stringify(snapshot).replace(/https?:\/\/www\.w3\.org\/[^\s"'\\]*/g, 'xml-namespace'),
  );

export const assertSnapshotHygiene = (snapshot, label) =>
  assertCorpusHygiene(hygieneView(snapshot), label);

export const buildSnapshot = ({ cases, recordedAt }) => ({
  version: snapshotVersion,
  recordedAt,
  cases: [...cases].sort((a, b) => a.tool.localeCompare(b.tool) || a.id.localeCompare(b.id)),
});

export const validateSnapshot = (snapshot) => {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new Error('snapshot must be an object');
  }
  if (snapshot.version !== snapshotVersion) {
    throw new Error(`snapshot version must be ${snapshotVersion}`);
  }
  if (typeof snapshot.recordedAt !== 'string' || Number.isNaN(Date.parse(snapshot.recordedAt))) {
    throw new Error('snapshot recordedAt must be an ISO timestamp');
  }
  if (!Array.isArray(snapshot.cases) || snapshot.cases.length === 0) {
    throw new Error('snapshot must contain at least one case');
  }
  const ids = new Set();
  for (const item of snapshot.cases) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('snapshot case must be an object');
    }
    if (typeof item.id !== 'string' || !item.id) throw new Error('snapshot case requires an id');
    if (typeof item.tool !== 'string' || !item.tool) throw new Error(`${item.id} requires a tool`);
    if (typeof item.ageBand !== 'string' || !item.ageBand) throw new Error(`${item.id} requires an ageBand`);
    if (!item.request || typeof item.request !== 'object' || Array.isArray(item.request)) {
      throw new Error(`${item.id} requires the request it was recorded from`);
    }
    if (!item.output || typeof item.output !== 'object' || Array.isArray(item.output)) {
      throw new Error(`${item.id} requires an object output`);
    }
    if (ids.has(item.id)) throw new Error(`duplicate snapshot case id: ${item.id}`);
    ids.add(item.id);
  }
  return snapshot;
};

export const recordProviderOutputs = async ({ datasets, agentFunctions, now = () => new Date() }) => {
  const cases = [];
  for (const dataset of datasets) {
    const fn = agentFunctions[dataset.tool];
    if (typeof fn !== 'function') {
      throw new Error(`missing agent function for ${dataset.tool}`);
    }
    for (const caseDefinition of dataset.cases) {
      const request = { ...caseDefinition.request, ageBand: caseDefinition.ageBand };
      const output = await fn(request);
      cases.push({
        id: caseDefinition.id,
        tool: dataset.tool,
        ageBand: caseDefinition.ageBand,
        request,
        output,
      });
    }
  }
  return buildSnapshot({ cases, recordedAt: now().toISOString() });
};

const parseArgs = (argv) => {
  const options = { output: defaultSnapshotPath };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--output') {
      options.output = argv[++i] ?? options.output;
    } else if (arg === '--') {
      continue;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(import.meta.dirname, '..');
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required to record provider evaluations.');
  }

  const [
    { createOpenAIProvider },
    { craftVoiceReply },
    { planStory },
    { generateColoringOutline },
    { planExperiment },
  ] = await Promise.all([
    import('../apps/agent-service/src/provider.ts'),
    import('../apps/agent-service/src/agents/voiceAgent.ts'),
    import('../apps/agent-service/src/agents/storyAgent.ts'),
    import('../apps/agent-service/src/agents/imageAgent.ts'),
    import('../apps/agent-service/src/agents/experimentAgent.ts'),
  ]);

  const provider = textOnlyProvider(createOpenAIProvider(apiKey));
  const datasets = await loadEvaluationDatasets({ repoRoot });
  const snapshot = await recordProviderOutputs({
    datasets,
    agentFunctions: {
      voice_chat: (request) => craftVoiceReply(request, provider),
      story_panels: (request) => planStory(request, provider),
      coloring_outline: (request) => generateColoringOutline(request, provider),
      science_sim: (request) => planExperiment(request, provider),
    },
  });

  validateSnapshot(snapshot);
  // Model output is corpus too: a recorded URL, address, or key must never be
  // committed, and for a children's product it must never be replayed either.
  assertSnapshotHygiene(snapshot, path.basename(options.output));

  const destination = path.resolve(repoRoot, options.output);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  console.log(`recorded ${snapshot.cases.length} provider cases -> ${destination}`);
};

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
