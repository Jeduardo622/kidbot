import { readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class TaskInputError extends Error {
  code = "INVALID_INPUT";
}

export class ScopeResolutionError extends Error {
  code = "UNRESOLVED_SCOPE";
}

const CLASSIFICATIONS = ["review-only", "standard", "protected"];
const PRECEDENCE = new Map(CLASSIFICATIONS.map((value, index) => [value, index]));
const RULE_KEYS = ["classification", "id", "patterns", "requiresHumanReview"];
const POLICY_KEYS = ["rules", "verification", "version"];
const ALLOWED_VERIFICATION_COMMANDS = new Set([
  "pnpm run test:harness",
  "pnpm run lint",
  "pnpm run typecheck",
  "pnpm test",
  "pnpm --filter @kidbot/mcp-server run test:compat",
  "pnpm run verify:local",
]);

function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} must contain exactly: ${expected.join(", ")}`);
  }
}

function validateStringArray(value, label, { nonEmpty = false } = {}) {
  if (!Array.isArray(value) || (nonEmpty && value.length === 0) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new Error(`${label} must be ${nonEmpty ? "a non-empty" : "an"} array of non-empty strings`);
  }
}

function globToRegExp(pattern) {
  if (pattern.startsWith("/") || pattern.includes("\\") || pattern.split("/").includes("..")) {
    throw new Error(`policy pattern must be an anchored POSIX repository path: ${pattern}`);
  }
  let source = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*" && pattern[index + 1] === "*") {
      if (pattern[index + 2] === "/") {
        source += "(?:.*/)?";
        index += 2;
      } else {
        source += ".*";
        index += 1;
      }
    } else if (character === "*") {
      source += "[^/]*";
    } else if (character === "?") {
      source += "[^/]";
    } else {
      source += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return new RegExp(`${source}$`);
}

function validatePolicy(policy) {
  assertExactKeys(policy, POLICY_KEYS, "policy");
  if (!Number.isInteger(policy.version) || policy.version < 1) throw new Error("policy version must be a positive integer");
  if (!Array.isArray(policy.rules) || policy.rules.length === 0) throw new Error("policy rules must be a non-empty array");

  const ids = new Set();
  for (const [index, rule] of policy.rules.entries()) {
    assertExactKeys(rule, RULE_KEYS, `policy rule ${index}`);
    if (typeof rule.id !== "string" || rule.id.length === 0 || ids.has(rule.id)) throw new Error("policy rule id must be a unique non-empty string");
    ids.add(rule.id);
    if (!CLASSIFICATIONS.includes(rule.classification)) throw new Error(`invalid policy classification: ${rule.classification}`);
    validateStringArray(rule.patterns, `patterns for ${rule.id}`, { nonEmpty: true });
    rule.patterns.forEach(globToRegExp);
    if (typeof rule.requiresHumanReview !== "boolean") throw new Error(`requiresHumanReview for ${rule.id} must be boolean`);
  }

  assertExactKeys(policy.verification, [...CLASSIFICATIONS].sort(), "policy verification");
  for (const classification of CLASSIFICATIONS) {
    validateStringArray(policy.verification[classification], `verification.${classification}`);
    for (const command of policy.verification[classification]) {
      if (!ALLOWED_VERIFICATION_COMMANDS.has(command)) {
        throw new Error(`verification command is not permitted: ${command}`);
      }
    }
  }
  if (!policy.verification.protected.includes("pnpm run verify:local")) {
    throw new Error("protected verification must include pnpm run verify:local");
  }
  return policy;
}

export async function loadEngineeringPolicy({ repoRoot, policyPath } = {}) {
  if (typeof repoRoot !== "string" || repoRoot.length === 0) throw new Error("repoRoot is required");
  const resolvedPath = policyPath ? path.resolve(policyPath) : path.resolve(repoRoot, ".agents", "engineering-policy.json");
  try {
    return validatePolicy(JSON.parse(await readFile(resolvedPath, "utf8")));
  } catch (error) {
    throw new Error(`Unable to load engineering policy at ${resolvedPath}: ${error.message}`, { cause: error });
  }
}

function normalizeRepoPath(repoRoot, candidate) {
  if (typeof candidate !== "string" || candidate.trim().length === 0) throw new Error("scope paths must be non-empty strings");
  const portable = candidate.replaceAll("\\", "/");
  const absolute = path.resolve(repoRoot, portable);
  const relative = path.relative(path.resolve(repoRoot), absolute);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`path is outside repository or does not select a file: ${candidate}`);
  }
  return relative.split(path.sep).join("/");
}

export function parseGitNameStatus(stdout) {
  const fields = stdout.split("\0");
  if (fields.at(-1) === "") fields.pop();
  const paths = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index];
    index += 1;
    if (!status) throw new ScopeResolutionError("Git returned an invalid empty status");
    const pathCount = /^[RC]/u.test(status) ? 2 : 1;
    if (index + pathCount > fields.length) throw new ScopeResolutionError(`Git returned incomplete ${status} status data`);
    paths.push(...fields.slice(index, index + pathCount));
    index += pathCount;
  }
  return paths;
}

async function gitPaths(repoRoot, args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  return parseGitNameStatus(stdout);
}

async function gitListedPaths(repoRoot, args) {
  const { stdout } = await execFileAsync("git", args, { cwd: repoRoot, encoding: "utf8", windowsHide: true });
  return stdout.split("\0").filter(Boolean);
}

export async function resolveScope({ repoRoot, base, explicitPaths } = {}) {
  if (typeof repoRoot !== "string" || repoRoot.length === 0) throw new Error("repoRoot is required");
  if (base !== undefined && (typeof base !== "string" || base.length === 0)) throw new TaskInputError("base must be a non-empty Git ref");
  if (explicitPaths !== undefined && !Array.isArray(explicitPaths)) throw new TaskInputError("explicitPaths must be an array");
  if (base !== undefined && explicitPaths?.length) throw new TaskInputError("--base cannot be combined with explicit paths");

  if (explicitPaths?.length) {
    let normalized;
    try {
      normalized = [...new Set(explicitPaths.map((candidate) => normalizeRepoPath(repoRoot, candidate)))].sort();
    } catch (error) {
      throw new TaskInputError(error.message, { cause: error });
    }
    const expanded = [];
    for (const candidate of normalized) {
      try {
        const entry = await stat(path.resolve(repoRoot, candidate));
        if (entry.isFile()) expanded.push(candidate);
        else if (entry.isDirectory()) {
          const files = await gitListedPaths(repoRoot, ["ls-files", "-co", "--exclude-standard", "-z", "--", candidate]);
          if (files.length === 0) throw new TaskInputError(`explicit directory contains no routable files: ${candidate}`);
          expanded.push(...files.map((file) => normalizeRepoPath(repoRoot, file)));
        } else throw new TaskInputError(`explicit path is not a file or directory: ${candidate}`);
      } catch (error) {
        if (error instanceof TaskInputError) throw error;
        throw new TaskInputError(`explicit path does not exist or is unreadable: ${candidate}`, { cause: error });
      }
    }
    return [...new Set(expanded)].sort();
  }

  try {
    const groups = [];
    const statusArgs = ["--name-status", "-z", "--find-renames", "--find-copies", "--diff-filter=ACDMRTUXB"];
    if (base !== undefined) groups.push(await gitPaths(repoRoot, ["diff", ...statusArgs, `${base}...HEAD`, "--"]));
    groups.push(await gitPaths(repoRoot, ["diff", "--cached", ...statusArgs, "--"]));
    groups.push(await gitPaths(repoRoot, ["diff", ...statusArgs, "--"]));
    groups.push(await gitListedPaths(repoRoot, ["ls-files", "--others", "--exclude-standard", "-z"]));
    const resolved = [...new Set(groups.flat().map((candidate) => normalizeRepoPath(repoRoot, candidate)))].sort();
    if (resolved.length === 0) throw new ScopeResolutionError("Git scope contains no changed paths");
    return resolved;
  } catch (error) {
    throw new ScopeResolutionError(`Unable to resolve Git scope: ${error.message}`, { cause: error });
  }
}

export function classifyPaths({ repoRoot, paths, policy } = {}) {
  if (typeof repoRoot !== "string" || repoRoot.length === 0) throw new Error("repoRoot is required");
  validatePolicy(policy);
  if (!Array.isArray(paths) || paths.length === 0) throw new Error("empty scope requires an explicit scope");

  const normalizedPaths = [...new Set(paths.map((candidate) => normalizeRepoPath(repoRoot, candidate)))].sort();
  const compiledRules = policy.rules.map((rule) => ({
    ...rule,
    expressions: rule.patterns.map(globToRegExp),
  }));
  const matches = normalizedPaths.map((candidate) => {
    const matchingRules = compiledRules
      .filter((rule) => rule.expressions.some((expression) => expression.test(candidate)))
      .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
    if (matchingRules.length === 0) throw new Error(`path is not covered by policy: ${candidate}`);
    return {
      path: candidate,
      rules: matchingRules.map((rule) => rule.id),
      classification: matchingRules.reduce(
        (highest, rule) => PRECEDENCE.get(rule.classification) > PRECEDENCE.get(highest) ? rule.classification : highest,
        "review-only",
      ),
    };
  });
  const classification = matches.reduce(
    (highest, match) => PRECEDENCE.get(match.classification) > PRECEDENCE.get(highest) ? match.classification : highest,
    "review-only",
  );
  const matchedRuleIds = new Set(matches.flatMap((match) => match.rules));
  const requiresHumanReview = classification === "protected" || policy.rules.some((rule) => matchedRuleIds.has(rule.id) && rule.requiresHumanReview);

  return {
    classification,
    paths: normalizedPaths,
    matches,
    commands: [...policy.verification[classification]],
    requiresHumanReview,
  };
}
