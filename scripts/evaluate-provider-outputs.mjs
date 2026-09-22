#!/usr/bin/env node
/**
 * Score recorded provider output with the deterministic rubric.
 *
 * Same corpus, same checks, same thresholds as `eval:ai` — only the source of
 * the output differs. The stub run stays as a contract test; this run is what
 * can actually catch the model getting worse at talking to a child.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  evaluateDatasets,
  formatEvaluationReport,
  loadEvaluationDatasets,
} from './evaluate-ai-outputs.mjs';
import {
  assertSnapshotHygiene,
  defaultSnapshotPath,
  validateSnapshot,
} from './record-provider-evals.mjs';

export const loadSnapshot = async ({ repoRoot, snapshotPath = defaultSnapshotPath }) => {
  const resolved = path.resolve(repoRoot, snapshotPath);
  const relative = path.relative(path.resolve(repoRoot), resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('snapshot path must stay inside the repository');
  }
  let parsed;
  try {
    parsed = JSON.parse(await readFile(resolved, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(
        `No provider snapshot at ${relative}. Run \`pnpm run eval:ai:record-provider\` with a provider key first.`,
      );
    }
    throw new Error(`Invalid provider snapshot JSON at ${relative}: ${error.message}`);
  }
  validateSnapshot(parsed);
  assertSnapshotHygiene(parsed, path.basename(relative));
  return parsed;
};

/** Order-independent key: the exact request a case is evaluated with. */
export const requestKey = (tool, request) => {
  const entries = Object.entries(request ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return `${tool}::${JSON.stringify(entries)}`;
};

/**
 * Replay recorded output through the rubric, matched by request rather than by
 * call order. A corpus case missing from the snapshot is an error, not a skip:
 * a silently shrinking evaluation is the failure mode this gate exists to
 * prevent.
 */
export const buildReplayFunctions = ({ datasets, snapshot }) => {
  const outputs = new Map(
    snapshot.cases.map((item) => [requestKey(item.tool, item.request), item.output]),
  );
  const expected = new Set();
  const functions = {};

  for (const dataset of datasets) {
    for (const caseDefinition of dataset.cases) {
      const key = requestKey(dataset.tool, {
        ...caseDefinition.request,
        ageBand: caseDefinition.ageBand,
      });
      if (!outputs.has(key)) {
        throw new Error(
          `provider snapshot is missing ${dataset.tool}/${caseDefinition.id}; re-record the snapshot`,
        );
      }
      expected.add(key);
    }
    functions[dataset.tool] = (request) => {
      const key = requestKey(dataset.tool, request);
      if (!outputs.has(key)) {
        throw new Error(`provider snapshot has no recording for a ${dataset.tool} request`);
      }
      return outputs.get(key);
    };
  }

  const extra = [...outputs.keys()].filter((key) => !expected.has(key));
  if (extra.length > 0) {
    throw new Error(`provider snapshot has ${extra.length} case(s) that are not in the corpus`);
  }

  return functions;
};

export const formatProviderReport = (result, { snapshot, json = false }) => {
  if (json) {
    return `${JSON.stringify({ ...result, recordedAt: snapshot.recordedAt, source: 'provider' }, null, 2)}\n`;
  }
  return formatEvaluationReport(result, {})
    .replace(
      'AI output evaluation (deterministic, no-provider)',
      `AI output evaluation (recorded provider output, recorded ${snapshot.recordedAt})`,
    );
};

const parseArgs = (argv) => {
  const options = { snapshotPath: defaultSnapshotPath, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--snapshot') {
      options.snapshotPath = argv[++i] ?? options.snapshotPath;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--') {
      continue;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
};

export const runProviderEvaluation = async ({ repoRoot, snapshotPath, json = false }) => {
  const snapshot = await loadSnapshot({ repoRoot, snapshotPath });
  const datasets = await loadEvaluationDatasets({ repoRoot });
  const agentFunctions = buildReplayFunctions({ datasets, snapshot });
  const result = await evaluateDatasets({ datasets, agentFunctions });
  return { result, snapshot, report: formatProviderReport(result, { snapshot, json }) };
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(import.meta.dirname, '..');
  const { result, report } = await runProviderEvaluation({ repoRoot, ...options });
  process.stdout.write(report);
  process.exitCode = result.passed ? 0 : 1;
};

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 2;
  });
}
