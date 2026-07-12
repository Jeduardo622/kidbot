import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { validateCurrentEvaluationResult } from "./ai-evaluation-baseline.mjs";

const MAX_BYTES = 32 * 1024;
const FINGERPRINT = /^[0-9a-f]{64}$/;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TOOLS = new Set(["voice_chat", "story_panels", "coloring_outline", "science_sim"]);
const AGES = new Set(["4-6", "7-9", "10-12"]);
const identity = value => `${value.dev}:${value.ino}:${value.nlink}`;
const objectIdentity = value => `${value.dev}:${value.ino}`;
const exactKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join("|") === [...keys].sort().join("|");
const normalized = value => Number.isFinite(value) && value >= 0 && value <= 100 && Number(value.toFixed(2)) === value;

function sanitize(value) {
  if (typeof value !== "string") throw new Error("summary dynamic value must be a string");
  if (/(?:[a-z]:\\|(?:^|\s)\/(?:home|users?|tmp|var|etc)\/|\b(?:home|[a-z_]*(?:key|token|secret|password))\s*=|\b(?:bearer|basic)\s+|["'{]\s*(?:payload|request|output)\b|\b(?:payload|request|output)\s*:)/i.test(value)) throw new Error("summary dynamic value is unsafe");
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\b(?:token|secret|password|api[_-]?key)\s*=\s*[^\s]+/gi, "[redacted]")
    .replace(/[\\`*_{}\[\]<>\(\)#+\-.!|]/g, "\\$&");
}

function validateResult(result) {
  validateCurrentEvaluationResult(result);
  if (!exactKeys(result, ["version", "cases", "tools", "overallMean", "passed", "thresholds"]) || result.version !== 1) throw new Error("summary result has invalid exact keys");
  const caseIds = new Set();
  for (const item of result.cases) {
    if (!exactKeys(item, ["id", "tool", "ageBand", "categoryScores", "score", "hardFailures", "passed", "checks"]) || !ID.test(item.id) || !TOOLS.has(item.tool) || !AGES.has(item.ageBand) || caseIds.has(item.id) || !exactKeys(item.categoryScores, ["contract", "safety", "completeness", "age-proxy"]) || !Object.values(item.categoryScores).every(Number.isFinite) || !Array.isArray(item.checks) || item.checks.some(value => !exactKeys(value, ["id", "category", "passed", "message"]) || !ID.test(value.id) || !["contract", "safety", "completeness", "age-proxy"].includes(value.category) || typeof value.passed !== "boolean" || typeof value.message !== "string")) throw new Error("summary result case is invalid");
    if (Object.values(item.categoryScores).reduce((sum, value) => sum + value, 0) !== item.score || item.passed !== (item.score >= result.thresholds.case && item.hardFailures.length === 0)) throw new Error("summary result case totals are inconsistent");
    caseIds.add(item.id);
  }
  const toolIds = new Set();
  for (const item of result.tools) {
    if (!exactKeys(item, ["tool", "mean", "passed"]) || !TOOLS.has(item.tool) || toolIds.has(item.tool)) throw new Error("summary result tool is invalid");
    const cases = result.cases.filter(value => value.tool === item.tool);
    const mean = cases.length ? Number((cases.reduce((sum, value) => sum + value.score, 0) / cases.length).toFixed(2)) : NaN;
    if (item.mean !== mean || item.passed !== (mean >= result.thresholds.toolMean)) throw new Error("summary result tool totals are inconsistent");
    toolIds.add(item.tool);
  }
  if (result.cases.some(item => !toolIds.has(item.tool)) || result.tools.some(item => !result.cases.some(value => value.tool === item.tool))) throw new Error("summary result identities are inconsistent");
  const overall = result.cases.length ? Number((result.cases.reduce((sum, value) => sum + value.score, 0) / result.cases.length).toFixed(2)) : 0;
  const passed = result.cases.length > 0 && result.cases.every(item => item.passed) && result.tools.every(item => item.passed) && overall >= result.thresholds.overallMean;
  if (result.overallMean !== overall || result.passed !== passed) throw new Error("summary result totals are inconsistent");
}

function validateDelta(item, scope, requireId) {
  const keys = requireId ? ["scope", "id", "baseline", "current", "delta"] : ["scope", "baseline", "current", "delta"];
  if (!exactKeys(item, keys) || item.scope !== scope || (requireId && typeof item.id !== "string")) throw new Error("summary comparison delta is invalid");
  for (const key of ["baseline", "current", "delta"]) if (!normalized(item[key]) && !(key === "delta" && Number.isFinite(item[key]) && Number(item[key].toFixed(2)) === item[key] && item[key] >= -100 && item[key] <= 100)) throw new Error("summary comparison metric is invalid");
  if (item.delta !== Number((item.current - item.baseline).toFixed(2))) throw new Error("summary comparison delta is inconsistent");
}

function validateComparison(value, result) {
  if (!exactKeys(value, ["fingerprint", "cases", "tools", "overall", "unchangedCount", "regressions", "passed"]) || !FINGERPRINT.test(value.fingerprint) || !Array.isArray(value.cases) || !Array.isArray(value.tools) || !Array.isArray(value.regressions) || !Number.isInteger(value.unchangedCount) || value.unchangedCount < 0 || typeof value.passed !== "boolean") throw new Error("summary comparison is invalid");
  const caseIds = new Set(); for (const item of value.cases) { validateDelta(item, "case", true); if (!ID.test(item.id) || caseIds.has(item.id)) throw new Error("summary comparison duplicate or invalid case"); caseIds.add(item.id); }
  const toolIds = new Set(); for (const item of value.tools) { validateDelta(item, "tool", true); if (!TOOLS.has(item.id) || toolIds.has(item.id)) throw new Error("summary comparison duplicate or invalid tool"); toolIds.add(item.id); }
  validateDelta(value.overall, "overall", false);
  const deltaRegressions = new Map();
  const identityRegressions = { case: new Map(), tool: new Map() };
  let fingerprintRegressions = 0; let absoluteRegressions = 0;
  for (const item of value.regressions) {
    if (item?.delta !== undefined) {
      validateDelta(item, item.scope, item.scope !== "overall");
      if (!['case','tool','overall'].includes(item.scope) || item.delta >= 0) throw new Error("summary comparison regression delta is invalid");
      const source = item.scope === "overall" ? value.overall : value[`${item.scope}s`].find(entry => entry.id === item.id);
      if (!source || JSON.stringify(source) !== JSON.stringify(item)) throw new Error("summary comparison regression delta is inconsistent");
      const key = `${item.scope}:${item.id ?? ""}`; if (deltaRegressions.has(key)) throw new Error("summary comparison duplicate regression"); deltaRegressions.set(key, item);
    } else if (item?.scope === "fingerprint") {
      if (!exactKeys(item, ["scope", "baseline", "current"]) || !FINGERPRINT.test(item.baseline) || item.current !== value.fingerprint || item.baseline === item.current || ++fingerprintRegressions > 1) throw new Error("summary comparison fingerprint regression is invalid");
    } else if (item?.scope === "absolute") {
      if (!exactKeys(item, ["scope", "reason"]) || item.reason !== "current evaluation failed" || ++absoluteRegressions > 1) throw new Error("summary comparison absolute regression is invalid");
    } else if (item?.scope === "case" || item?.scope === "tool") {
      if (!exactKeys(item, ["scope", "id", "reason"]) || !ID.test(item.id) || !["identity drift", "missing current identity", "extra current identity"].includes(item.reason)) throw new Error("summary comparison identity regression is invalid");
      if (identityRegressions[item.scope].has(item.id)) throw new Error("summary comparison duplicate identity regression"); identityRegressions[item.scope].set(item.id, item.reason);
    } else throw new Error("summary comparison regression is invalid");
  }
  const unchanged = [...value.cases, ...value.tools, value.overall].filter(item => item.delta === 0).length;
  const negative = [...value.cases, ...value.tools, value.overall].filter(item => item.delta < 0);
  if (negative.length !== deltaRegressions.size || negative.some(item => !deltaRegressions.has(`${item.scope}:${item.id ?? ""}`))) throw new Error("summary comparison regression coverage is inconsistent");
  if (absoluteRegressions !== (result.passed ? 0 : 1)) throw new Error("summary comparison absolute state is inconsistent");
  const resultCases = new Map(result.cases.map(item => [item.id, item])); const resultTools = new Map(result.tools.map(item => [item.tool, item]));
  for (const item of value.cases) if (resultCases.get(item.id)?.score !== item.current || identityRegressions.case.has(item.id)) throw new Error("summary comparison case current is inconsistent");
  for (const item of value.tools) if (resultTools.get(item.id)?.mean !== item.current || identityRegressions.tool.has(item.id)) throw new Error("summary comparison tool current is inconsistent");
  for (const id of resultCases.keys()) if (!caseIds.has(id) && !["identity drift", "extra current identity"].includes(identityRegressions.case.get(id))) throw new Error("summary comparison case identities are inconsistent");
  for (const id of resultTools.keys()) if (!toolIds.has(id) && !["identity drift", "extra current identity"].includes(identityRegressions.tool.get(id))) throw new Error("summary comparison tool identities are inconsistent");
  for (const [id, reason] of identityRegressions.case) if ((reason === "missing current identity") === resultCases.has(id)) throw new Error("summary comparison case identity reason is inconsistent");
  for (const [id, reason] of identityRegressions.tool) if ((reason === "missing current identity") === resultTools.has(id)) throw new Error("summary comparison tool identity reason is inconsistent");
  if (value.overall.current !== result.overallMean || value.unchangedCount !== unchanged || value.passed !== (result.passed && value.regressions.length === 0)) throw new Error("summary comparison totals are inconsistent");
}

const metricLine = item => {
  const label = item.scope === "overall" ? "overall" : `${item.scope}/${sanitize(item.id)}`;
  const sign = item.delta > 0 ? "+" : "";
  return `  - ${label}: baseline=${item.baseline.toFixed(2)} current=${item.current.toFixed(2)} delta=${sign}${item.delta.toFixed(2)}`;
};

export function formatEvaluationJobSummary({ result, baseline }) {
  validateResult(result);
  validateComparison(baseline, result);
  const changed = [
    ...baseline.cases.filter(item => item.delta !== 0).sort((a, b) => a.id.localeCompare(b.id)),
    ...baseline.tools.filter(item => item.delta !== 0).sort((a, b) => a.id.localeCompare(b.id)),
  ];
  if (baseline.overall.delta !== 0) changed.push(baseline.overall);
  const reasons = baseline.regressions.filter(item => item.delta === undefined).map(item => {
    const label = item.scope === "fingerprint" ? "fingerprint" : `${sanitize(item.scope)}${item.id ? `/${sanitize(item.id)}` : ""}`;
    const reason = item.scope === "fingerprint" ? "fingerprint drift" : (item.reason ?? "drift");
    return `  - ${label}: ${sanitize(reason)}`;
  }).sort();
  const lines = [
    `## AI output evaluation: ${result.passed && baseline.passed ? "Passed" : "Failed"}`,
    "",
    `- Fingerprint: \`${baseline.fingerprint}\``,
    `- Absolute totals: cases=${result.cases.length} tools=${result.tools.length} overall=${result.overallMean.toFixed(2)}`,
    "- Changed metrics:",
    ...(changed.length ? changed.map(metricLine) : ["  - none"]),
    `- Drift reasons: ${reasons.length ? "" : "none"}`,
    ...reasons,
    `- **Baseline:** ${baseline.unchangedCount} unchanged; ${baseline.regressions.length} regressions`,
  ];
  const markdown = `${lines.join("\n")}\n`;
  if (Buffer.byteLength(markdown) > MAX_BYTES) throw new Error("evaluation summary exceeds 32 KiB");
  return markdown;
}

async function invokeHook(testHooks, phase) {
  if (testHooks?.phase !== undefined) {
    if (typeof testHooks.phase !== "function") throw new Error("summary test hook is invalid");
    await testHooks.phase(phase);
  }
}

export async function appendEvaluationJobSummary({ summaryPath, markdown, testHooks } = {}) {
  if (typeof summaryPath !== "string" || !path.isAbsolute(summaryPath)) throw new Error("summary path must be absolute");
  if (typeof markdown !== "string") throw new Error("summary markdown must be a string");
  const buffer = Buffer.from(markdown);
  if (buffer.byteLength > MAX_BYTES) throw new Error("evaluation summary exceeds 32 KiB");

  const lexicalParent = path.dirname(summaryPath);
  const parentBefore = await lstat(lexicalParent);
  if (!parentBefore.isDirectory() || parentBefore.isSymbolicLink()) throw new Error("summary parent must be an unlinked directory");
  if (await realpath(lexicalParent) !== path.resolve(lexicalParent)) throw new Error("summary parent physical path mismatch");
  const destinationBefore = await lstat(summaryPath);
  if (!destinationBefore.isFile() || destinationBefore.isSymbolicLink() || destinationBefore.nlink !== 1) throw new Error("summary must be an existing single-link regular file");
  const pinnedDestination = identity(destinationBefore);
  const pinnedParent = objectIdentity(parentBefore);

  const verify = async (handle, statHandle = () => handle.stat()) => {
    const parentNow = await lstat(lexicalParent);
    if (objectIdentity(parentNow) !== pinnedParent || !parentNow.isDirectory() || parentNow.isSymbolicLink() || await realpath(lexicalParent) !== path.resolve(lexicalParent)) throw new Error("summary parent identity changed");
    const destinationNow = await lstat(summaryPath);
    const handleNow = await statHandle();
    if (!destinationNow.isFile() || destinationNow.isSymbolicLink() || destinationNow.nlink !== 1 || identity(destinationNow) !== pinnedDestination || identity(handleNow) !== pinnedDestination) throw new Error("summary identity or link state changed");
  };

  await invokeHook(testHooks, "before-open");
  const handle = await open(summaryPath, constants.O_RDWR | (constants.O_NOFOLLOW ?? 0));
  let appendHandle;
  try {
    appendHandle = await open(summaryPath, constants.O_WRONLY | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0));
  } catch (error) {
    await handle.close().catch(() => {});
    throw error;
  }
  let appendStarted = false;
  let appendFailed = false;
  try {
    await invokeHook(testHooks, "after-open");
    await verify(handle);
    if (identity(await appendHandle.stat()) !== pinnedDestination) throw new Error("summary append handle identity changed");
    const opened = await handle.stat();
    let separator = Buffer.alloc(0);
    if (opened.size > 0) {
      const finalByte = Buffer.alloc(1);
      const read = await handle.read(finalByte, 0, 1, opened.size - 1);
      if (read.bytesRead !== 1) throw new Error("summary final byte could not be read");
      if (finalByte[0] !== 10) separator = Buffer.from("\n");
    }
    await verify(handle);
    const appendBuffer = separator.length ? Buffer.concat([separator, buffer]) : buffer;
    let offset = 0;
    appendStarted = true;
    while (offset < appendBuffer.length) {
      const writer = testHooks?.write;
      if (writer !== undefined && typeof writer !== "function") throw new Error("summary write test hook is invalid");
      const writePosition = null;
      const written = await (writer ? writer(appendHandle, appendBuffer, offset, writePosition) : appendHandle.write(appendBuffer, offset, appendBuffer.length - offset, writePosition));
      if (!Number.isInteger(written?.bytesWritten) || written.bytesWritten <= 0 || written.bytesWritten > appendBuffer.length - offset) throw new Error("summary append made no progress");
      offset += written.bytesWritten;
    }
    await invokeHook(testHooks, "after-write");
    await verify(handle);
    await handle.sync();
    await invokeHook(testHooks, "after-sync");
    await verify(handle);
    await invokeHook(testHooks, "before-final-verify");
    await verify(handle);
  } catch (error) {
    if (!appendStarted) throw error;
    appendFailed = true;
    throw new Error("summary append failed");
  } finally {
    let closeError;
    try {
      await appendHandle.close();
    } catch (error) {
      closeError = error;
    }
    try {
      await handle.close();
    } catch (error) {
      closeError ??= error;
    }
    if (closeError && !appendFailed) throw closeError;
  }
}

export async function writeEvaluationJobSummary({ result, baseline, env = process.env, testHooks } = {}) {
  const summaryPath = env?.GITHUB_STEP_SUMMARY;
  if (env?.GITHUB_ACTIONS !== "true" || typeof summaryPath !== "string" || summaryPath.length === 0 || !path.isAbsolute(summaryPath)) return { written: false };
  const markdown = formatEvaluationJobSummary({ result, baseline });
  await appendEvaluationJobSummary({ summaryPath, markdown, testHooks });
  return { written: true };
}
