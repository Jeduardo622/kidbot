import { randomUUID } from "node:crypto";
import { lstat, open, readFile, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildBaselineManifest, buildEvaluationFingerprint, compareEvaluationToBaseline, formatBaselineManifest, loadBaselineManifest } from "./ai-evaluation-baseline.mjs";
import { evaluateLocally, loadEvaluationDatasets } from "./evaluate-ai-outputs.mjs";

const TARGET = path.join("evals", "baselines", "ai-output-baseline.json");
const REQUIRED_TOOLS = ["coloring_outline", "science_sim", "story_panels", "voice_chat"];
const REQUIRED_AGES = ["10-12", "4-6", "7-9"];
const identity = stat => ({ dev: stat.dev, ino: stat.ino });
const sameIdentity = (stat, expected) => stat.dev === expected.dev && stat.ino === expected.ino;

async function pinPaths(repoRoot) {
  const root = path.resolve(repoRoot);
  const physicalRoot = await realpath(root);
  if (physicalRoot !== root) throw new Error("repository root is linked or relocated");
  const directory = path.join(root, "evals", "baselines");
  const rootStat = await lstat(root);
  const dirStat = await lstat(directory);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || !dirStat.isDirectory() || dirStat.isSymbolicLink()) throw new Error("baseline path is invalid");
  if (await realpath(directory) !== path.join(physicalRoot, "evals", "baselines")) throw new Error("baseline directory is linked or relocated");
  return { root, directory, destination: path.join(directory, "ai-output-baseline.json"), rootIdentity: identity(rootStat), dirIdentity: identity(dirStat) };
}

async function recheck(paths) {
  const [rootStat, dirStat] = await Promise.all([lstat(paths.root), lstat(paths.directory)]);
  if (!sameIdentity(rootStat, paths.rootIdentity) || !sameIdentity(dirStat, paths.dirIdentity)) throw new Error("baseline parent identity changed");
}

function assertPassingCoverage(result, datasets) {
  if (!result?.passed || !Array.isArray(result.cases) || !Array.isArray(result.tools) || result.cases.some(item => item.passed !== true || item.hardFailures?.length || item.score < 85) || result.tools.some(item => item.passed !== true || item.mean < 90) || result.overallMean < 90) throw new Error("evaluation is not fully passing");
  const expectedCases = datasets.flatMap(dataset => dataset.cases.map(item => `${item.id}|${dataset.tool}|${item.ageBand}`)).sort();
  const actualCases = result.cases.map(item => `${item.id}|${item.tool}|${item.ageBand}`).sort();
  if (JSON.stringify(actualCases) !== JSON.stringify(expectedCases)) throw new Error("evaluation case identities do not match validated datasets");
  const tools = [...new Set(result.tools.map(item => item.tool))].sort();
  const ages = [...new Set(result.cases.map(item => item.ageBand))].sort();
  if (result.tools.length !== REQUIRED_TOOLS.length || JSON.stringify(tools) !== JSON.stringify(REQUIRED_TOOLS) || JSON.stringify(ages) !== JSON.stringify(REQUIRED_AGES)) throw new Error("evaluation coverage is incomplete");
}

async function install(paths, bytes, testHooks) {
  await recheck(paths);
  try {
    const target = await lstat(paths.destination);
    if (!target.isFile() || target.isSymbolicLink() || target.nlink !== 1) throw new Error("baseline target is linked or invalid");
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  const temporary = path.join(paths.directory, `.ai-output-baseline.${randomUUID()}.tmp`);
  let handle; let renamed = false; let verified = false;
  try {
    handle = await open(temporary, "wx", 0o600);
    const created = await handle.stat();
    if (!created.isFile() || created.nlink !== 1) throw new Error("temporary baseline identity anomaly");
    await testHooks?.afterTemporaryOpen?.(temporary);
    const beforeWrite = await lstat(temporary);
    if (!sameIdentity(beforeWrite, identity(created)) || beforeWrite.nlink !== 1) throw new Error("temporary baseline link anomaly");
    await handle.writeFile(bytes, "utf8");
    await handle.sync();
    await testHooks?.afterTemporaryWrite?.(temporary);
    const afterWrite = await lstat(temporary);
    if (!sameIdentity(afterWrite, identity(created)) || afterWrite.nlink !== 1) throw new Error("temporary baseline identity changed");
    await recheck(paths);
    await testHooks?.beforeRename?.(paths.destination);
    await recheck(paths);
    await handle.close(); handle = undefined;
    await rename(temporary, paths.destination); renamed = true;
    await testHooks?.afterRename?.(paths.destination);
    await recheck(paths);
    const installed = await lstat(paths.destination);
    if (!installed.isFile() || installed.isSymbolicLink() || installed.nlink !== 1 || !sameIdentity(installed, identity(created))) throw new Error("installed baseline identity anomaly");
    if (await readFile(paths.destination, "utf8") !== bytes) throw new Error("installed baseline bytes changed");
    verified = true;
  } finally {
    await handle?.close().catch(() => {});
    if (!renamed) await rm(temporary, { force: true }).catch(() => {});
    if (renamed && !verified) await rm(paths.destination, { force: true }).catch(() => {});
  }
}

export async function refreshEvaluationBaseline({ repoRoot, evaluate = evaluateLocally, io, testHooks, datasets } = {}) {
  if (typeof repoRoot !== "string" || !repoRoot || typeof evaluate !== "function") throw new TypeError("invalid refresh arguments");
  const paths = await pinPaths(repoRoot);
  const corpus = datasets ?? await loadEvaluationDatasets({ repoRoot: paths.root });
  const first = await evaluate(paths.root, corpus);
  const firstFingerprint = buildEvaluationFingerprint({ datasets: corpus });
  assertPassingCoverage(first, corpus);
  await testHooks?.afterFirstEvaluation?.();
  const second = await evaluate(paths.root, corpus);
  const secondFingerprint = buildEvaluationFingerprint({ datasets: corpus });
  assertPassingCoverage(second, corpus);
  await testHooks?.afterSecondEvaluation?.();
  if (JSON.stringify(first) !== JSON.stringify(second) || firstFingerprint !== secondFingerprint) throw new Error("evaluation is not deterministic");
  const current = buildBaselineManifest({ datasets: corpus, result: first });
  const bytes = formatBaselineManifest(current);
  let previous = null; let previousBytes = null;
  try { previous = await loadBaselineManifest({ repoRoot: paths.root }); previousBytes = formatBaselineManifest(previous); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const comparison = previous ? compareEvaluationToBaseline({ baseline: previous, datasets: corpus, result: first }) : null;
  const bytesChanged = previousBytes !== bytes;
  if (bytesChanged) await install(paths, bytes, testHooks);
  io?.write?.({ previous, current, comparison, bytesChanged });
  return { path: paths.destination, previous, current, comparison, bytesChanged };
}

function formatSummary(result) {
  const before = result.previous ? `overall=${result.previous.overallMean.toFixed(2)} cases=${result.previous.cases.length} tools=${result.previous.tools.length}` : "none";
  const after = `overall=${result.current.overallMean.toFixed(2)} cases=${result.current.cases.length} tools=${result.current.tools.length}`;
  const entries = result.comparison ? [...result.comparison.cases, ...result.comparison.tools, result.comparison.overall] : [];
  const positive = entries.filter(item => item.delta > 0).length;
  const negative = entries.filter(item => item.delta < 0).length;
  const added = result.comparison?.regressions.filter(item => item.reason === "extra current identity").length ?? result.current.cases.length + result.current.tools.length;
  const removed = result.comparison?.regressions.filter(item => item.reason === "missing current identity").length ?? 0;
  return `baseline refresh: passed (${result.bytesChanged ? "updated" : "unchanged"})\nbefore: ${before}\nafter: ${after}\ndeltas: positive=${positive} negative=${negative} added=${added} removed=${removed}\n`;
}

export async function runCli(args = process.argv.slice(2), options = {}) {
  const stderr = options.stderr ?? (value => process.stderr.write(value));
  const stdout = options.stdout ?? (value => process.stdout.write(value));
  if (args.length) { stderr("baseline refresh: invalid invocation\n"); return 2; }
  const repoRoot = path.resolve(options.repoRoot ?? path.join(import.meta.dirname, ".."));
  try { await pinPaths(repoRoot); }
  catch { stderr("baseline refresh: invalid path\n"); return 2; }
  try {
    const result = await refreshEvaluationBaseline({ repoRoot, evaluate: options.evaluate, io: options.io, testHooks: options.testHooks, datasets: options.datasets });
    stdout(formatSummary(result));
    return 0;
  } catch { stderr("baseline refresh: runtime error\n"); return 3; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) process.exitCode = await runCli();
