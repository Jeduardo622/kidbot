import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { EVALUATION_CONTRACT } from "./evaluate-ai-outputs.mjs";

export const BASELINE_VERSION = 1;
const TARGET = path.join("evals", "baselines", "ai-output-baseline.json");
const TOOLS = new Set(["voice_chat", "story_panels", "coloring_outline", "science_sim"]);
const AGES = new Set(["4-6", "7-9", "10-12"]);
const THRESHOLDS = EVALUATION_CONTRACT.thresholds;
const exactKeys = (v, keys) => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).sort().join("|") === [...keys].sort().join("|");
const normalized = n => Number.isFinite(n) && n >= 0 && n <= 100 && Number(n.toFixed(2)) === n;
const canonical = value => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
};

function fingerprintInput(datasets, contractMetadata, schemaVersion) {
  const corpus = [...datasets].map(dataset => ({ version: dataset.version, tool: dataset.tool, cases: [...dataset.cases].map(item => ({ id: item.id, request: canonical(item.request), expectedBlocked: item.expectedBlocked, ageBand: item.ageBand, checks: [...item.checks].sort() })).sort((a,b) => a.id.localeCompare(b.id)) })).sort((a,b) => a.tool.localeCompare(b.tool));
  return canonical({ baselineSchemaVersion: schemaVersion, contract: contractMetadata, datasets: corpus });
}

export function buildEvaluationFingerprint({ datasets }) {
  return buildEvaluationFingerprintForContract({ datasets, contractMetadata: EVALUATION_CONTRACT, schemaVersion: BASELINE_VERSION });
}

export function buildEvaluationFingerprintForContract({ datasets, contractMetadata, schemaVersion }) {
  if (!Array.isArray(datasets) || datasets.length === 0) throw new Error("validated datasets are required");
  if (!contractMetadata || !Number.isInteger(schemaVersion)) throw new Error("fingerprint contract metadata is required");
  return createHash("sha256").update(JSON.stringify(fingerprintInput(datasets, contractMetadata, schemaVersion))).digest("hex");
}

export function buildBaselineManifest({ datasets, result }) {
  const cases = [...result.cases].map(({ id, tool, ageBand, score }) => ({ id, tool, ageBand, score })).sort((a,b) => a.id.localeCompare(b.id));
  const tools = [...result.tools].map(({ tool, mean }) => ({ tool, mean: Number(mean.toFixed(2)) })).sort((a,b) => a.tool.localeCompare(b.tool));
  return { version: BASELINE_VERSION, fingerprint: buildEvaluationFingerprint({ datasets }), thresholds: { ...THRESHOLDS }, cases, tools, overallMean: Number(result.overallMean.toFixed(2)) };
}

export function formatBaselineManifest(manifest) {
  validateBaselineManifest(manifest);
  const ordered = {
    version: manifest.version,
    fingerprint: manifest.fingerprint,
    thresholds: { case: manifest.thresholds.case, toolMean: manifest.thresholds.toolMean, overallMean: manifest.thresholds.overallMean },
    cases: manifest.cases.map(x => ({ id:x.id, tool:x.tool, ageBand:x.ageBand, score:x.score })),
    tools: manifest.tools.map(x => ({ tool:x.tool, mean:x.mean })),
    overallMean: manifest.overallMean,
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

export function validateBaselineManifest(value) {
  if (!exactKeys(value, ["version","fingerprint","thresholds","cases","tools","overallMean"])) throw new Error("baseline has invalid exact keys");
  if (value.version !== BASELINE_VERSION || !/^[0-9a-f]{64}$/.test(value.fingerprint)) throw new Error("baseline has invalid version or fingerprint");
  if (!exactKeys(value.thresholds, ["case","toolMean","overallMean"]) || value.thresholds.case !== THRESHOLDS.case || value.thresholds.toolMean !== THRESHOLDS.toolMean || value.thresholds.overallMean !== THRESHOLDS.overallMean) throw new Error("baseline threshold drift");
  if (!Array.isArray(value.cases) || !Array.isArray(value.tools) || !normalized(value.overallMean)) throw new Error("baseline collections or mean invalid");
  let previous = ""; const ids = new Set();
  for (const item of value.cases) {
    if (!exactKeys(item,["id","tool","ageBand","score"]) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id) || !TOOLS.has(item.tool) || !AGES.has(item.ageBand) || !Number.isInteger(item.score) || item.score < 0 || item.score > 100 || item.id <= previous || ids.has(item.id)) throw new Error("baseline cases invalid, duplicate, or unsorted");
    previous = item.id; ids.add(item.id);
  }
  previous = ""; const toolIds = new Set();
  for (const item of value.tools) {
    if (!exactKeys(item,["tool","mean"]) || !TOOLS.has(item.tool) || !normalized(item.mean) || item.tool <= previous || toolIds.has(item.tool)) throw new Error("baseline tools invalid, duplicate, or unsorted");
    previous = item.tool; toolIds.add(item.tool);
  }
  return value;
}

export async function loadBaselineManifest({ repoRoot, baselinePath } = {}) {
  const root = path.resolve(repoRoot); const expected = path.join(root, TARGET); const selected = path.resolve(baselinePath ?? expected);
  if (selected !== expected) throw new Error("baseline path must be canonical and contained");
  const physicalRoot = await realpath(root); const directory = path.dirname(expected);
  const dirStat = await lstat(directory); if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) throw new Error("baseline directory is linked or invalid");
  if (await realpath(directory) !== path.join(physicalRoot,"evals","baselines")) throw new Error("baseline directory physical containment failed");
  const stat = await lstat(expected); if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error("baseline must be a single-link regular file");
  const bytes = await readFile(expected,"utf8"); let value; try { value = JSON.parse(bytes); } catch { throw new Error("baseline contains malformed JSON"); }
  validateBaselineManifest(value); if (formatBaselineManifest(value) !== bytes) throw new Error("baseline bytes are noncanonical"); return value;
}

export function compareEvaluationToBaseline({ baseline, datasets, result }) {
  validateBaselineManifest(baseline); validateCurrentEvaluationResult(result); const fingerprint = buildEvaluationFingerprint({ datasets }); const regressions = [];
  if (baseline.fingerprint !== fingerprint) regressions.push({ scope: "fingerprint", baseline: baseline.fingerprint, current: fingerprint });
  const cases = compareList("case", baseline.cases, result.cases, "id", "score", regressions, x => ({ tool:x.tool, ageBand:x.ageBand }));
  const tools = compareList("tool", baseline.tools, result.tools, "tool", "mean", regressions);
  const overall = deltaEntry("overall", undefined, baseline.overallMean, Number(result.overallMean.toFixed(2))); if (overall.delta < 0) regressions.push(overall);
  const thresholdsMatch = exactKeys(result.thresholds,["case","toolMean","overallMean"]) && result.thresholds.case===THRESHOLDS.case && result.thresholds.toolMean===THRESHOLDS.toolMean && result.thresholds.overallMean===THRESHOLDS.overallMean;
  const hasHardFailure = result.cases.some(x => Array.isArray(x.hardFailures) && x.hardFailures.length > 0);
  const absoluteFailures = result.passed === true && thresholdsMatch && !hasHardFailure ? [] : [{ scope:"absolute", reason:"current evaluation failed" }];
  regressions.push(...absoluteFailures); regressions.sort((a,b) => `${a.scope}:${a.id??""}`.localeCompare(`${b.scope}:${b.id??""}`));
  const unchangedCount = [...cases,...tools,overall].filter(x => x.delta === 0).length;
  return { fingerprint, cases, tools, overall, unchangedCount, regressions, passed: regressions.length === 0 };
}
function invalidCurrent(reason) { throw new Error(`current evaluation is invalid: ${reason}`); }
export function validateCurrentEvaluationResult(result) {
  if (!result || typeof result!=="object" || Array.isArray(result) || !Array.isArray(result.cases) || !Array.isArray(result.tools) || typeof result.passed!=="boolean") invalidCurrent("result shape");
  if (!exactKeys(result.thresholds,["case","toolMean","overallMean"]) || !Object.values(result.thresholds).every(Number.isFinite)) invalidCurrent("threshold shape");
  const caseIds=new Set(); for(const item of result.cases) {
    if (!item || typeof item!=="object" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id) || !TOOLS.has(item.tool) || !AGES.has(item.ageBand) || !Number.isInteger(item.score) || item.score<0 || item.score>100 || !Array.isArray(item.hardFailures) || item.hardFailures.some(x=>typeof x!=="string") || typeof item.passed!=="boolean") invalidCurrent("case shape or value");
    if(caseIds.has(item.id)) invalidCurrent("duplicate current case identity"); caseIds.add(item.id);
  }
  const toolIds=new Set(); for(const item of result.tools) {
    if (!item || typeof item!=="object" || !TOOLS.has(item.tool) || !normalized(item.mean) || typeof item.passed!=="boolean") invalidCurrent("tool shape or value");
    if(toolIds.has(item.tool)) invalidCurrent("duplicate current tool identity"); toolIds.add(item.tool);
  }
  if(!normalized(result.overallMean)) invalidCurrent("overall mean");
}
function deltaEntry(scope,id,baseline,current) { return { scope, ...(id === undefined ? {} : { id }), baseline, current, delta: Number((current-baseline).toFixed(2)) }; }
function compareList(scope, base, current, key, metric, regressions, identity) {
  const bm = new Map(base.map(x => [x[key],x])), cm = new Map(current.map(x => [x[key],x])); const out=[];
  for (const id of [...new Set([...bm.keys(),...cm.keys()])].sort()) { const b=bm.get(id), c=cm.get(id); if (!b || !c) { regressions.push({ scope, id, reason: b ? "missing current identity" : "extra current identity" }); continue; } if (identity && JSON.stringify(identity(b)) !== JSON.stringify(identity(c))) { regressions.push({ scope, id, reason:"identity drift" }); continue; } const d=deltaEntry(scope,id,b[metric],Number(c[metric].toFixed(2))); out.push(d); if(d.delta<0) regressions.push(d); }
  return out;
}
