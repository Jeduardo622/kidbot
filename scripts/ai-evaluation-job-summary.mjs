import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { validateCurrentEvaluationResult } from "./ai-evaluation-baseline.mjs";

const MAX_BYTES = 32 * 1024;
const FINGERPRINT = /^[0-9a-f]{64}$/;
const identity = value => `${value.dev}:${value.ino}:${value.nlink}`;
const objectIdentity = value => `${value.dev}:${value.ino}`;

function sanitize(value) {
  if (typeof value !== "string") throw new Error("summary dynamic value must be a string");
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\b(?:token|secret|password|api[_-]?key)\s*=\s*[^\s]+/gi, "[redacted]")
    .replace(/[\\`*_{}\[\]<>\(\)#+\-.!|]/g, "\\$&");
}

function validateDelta(item, scope, requireId) {
  if (!item || typeof item !== "object" || item.scope !== scope) throw new Error("summary comparison delta is invalid");
  if (requireId && typeof item.id !== "string") throw new Error("summary comparison identity is invalid");
  for (const key of ["baseline", "current", "delta"]) if (!Number.isFinite(item[key])) throw new Error("summary comparison metric is invalid");
}

function validateComparison(value) {
  if (!value || typeof value !== "object" || !FINGERPRINT.test(value.fingerprint) || !Array.isArray(value.cases) || !Array.isArray(value.tools) || !Array.isArray(value.regressions) || !Number.isInteger(value.unchangedCount) || value.unchangedCount < 0 || typeof value.passed !== "boolean") throw new Error("summary comparison is invalid");
  for (const item of value.cases) validateDelta(item, "case", true);
  for (const item of value.tools) validateDelta(item, "tool", true);
  validateDelta(value.overall, "overall", false);
  for (const item of value.regressions) {
    if (!item || typeof item !== "object" || typeof item.scope !== "string") throw new Error("summary comparison regression is invalid");
    if (item.reason !== undefined && typeof item.reason !== "string") throw new Error("summary comparison reason is invalid");
  }
}

const metricLine = item => {
  const label = item.scope === "overall" ? "overall" : `${item.scope}/${sanitize(item.id)}`;
  const sign = item.delta > 0 ? "+" : "";
  return `  - ${label}: baseline=${item.baseline.toFixed(2)} current=${item.current.toFixed(2)} delta=${sign}${item.delta.toFixed(2)}`;
};

export function formatEvaluationJobSummary({ result, baseline }) {
  validateCurrentEvaluationResult(result);
  validateComparison(baseline);
  const changed = [...baseline.cases, ...baseline.tools]
    .filter(item => item.delta !== 0)
    .sort((a, b) => a.id.localeCompare(b.id));
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
    `- Unchanged metrics: ${baseline.unchangedCount}`,
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

  const verify = async handle => {
    const parentNow = await lstat(lexicalParent);
    if (objectIdentity(parentNow) !== pinnedParent || !parentNow.isDirectory() || parentNow.isSymbolicLink() || await realpath(lexicalParent) !== path.resolve(lexicalParent)) throw new Error("summary parent identity changed");
    const destinationNow = await lstat(summaryPath);
    const handleNow = await handle.stat();
    if (!destinationNow.isFile() || destinationNow.isSymbolicLink() || destinationNow.nlink !== 1 || identity(destinationNow) !== pinnedDestination || identity(handleNow) !== pinnedDestination) throw new Error("summary identity or link state changed");
  };

  await invokeHook(testHooks, "before-open");
  const handle = await open(summaryPath, constants.O_APPEND | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    await invokeHook(testHooks, "after-open");
    await verify(handle);
    await handle.write(buffer, 0, buffer.length, null);
    await invokeHook(testHooks, "after-write");
    await verify(handle);
    await handle.sync();
    await invokeHook(testHooks, "after-sync");
    await verify(handle);
    await invokeHook(testHooks, "after-verify");
  } finally {
    await handle.close();
  }
}

export async function writeEvaluationJobSummary({ result, baseline, env = process.env, testHooks } = {}) {
  const summaryPath = env?.GITHUB_STEP_SUMMARY;
  if (env?.GITHUB_ACTIONS !== "true" || typeof summaryPath !== "string" || summaryPath.length === 0 || !path.isAbsolute(summaryPath)) return { written: false };
  const markdown = formatEvaluationJobSummary({ result, baseline });
  await appendEvaluationJobSummary({ summaryPath, markdown, testHooks });
  return { written: true };
}
