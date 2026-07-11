import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  classifyPaths,
  loadEngineeringPolicy,
} from "../scripts/engineering-policy.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");

test("loads the repository engineering policy", async () => {
  const policy = await loadEngineeringPolicy({ repoRoot });
  assert.equal(policy.version, 1);
  assert.ok(policy.rules.length >= 3);
  assert.deepEqual(Object.keys(policy.verification).sort(), [
    "protected",
    "review-only",
    "standard",
  ]);
});

test("classifies workflow, auth, and configuration paths as protected", async () => {
  const policy = await loadEngineeringPolicy({ repoRoot });
  for (const candidate of [
    ".github/workflows/ci.yml",
    "apps/agent-service/src/auth/token.ts",
    "apps/agent-service/src/config.ts",
    "apps/mcp-server/src/auth-startup-matrix.test.mjs",
    "apps/agent-service/.env.example",
    "vite.config.ts",
    "apps/web-widget/tsconfig.app.json",
    "eslint.config.mjs",
    "package.json",
  ]) {
    const result = classifyPaths({ repoRoot, paths: [candidate], policy });
    assert.equal(result.classification, "protected", candidate);
    assert.equal(result.requiresHumanReview, true, candidate);
    assert.ok(result.commands.includes("pnpm run verify:local"), candidate);
  }
});

test("classifies Markdown-only scope as review-only", async () => {
  const policy = await loadEngineeringPolicy({ repoRoot });
  const result = classifyPaths({ repoRoot, paths: ["docs/guide.md", "README.md"], policy });
  assert.equal(result.classification, "review-only");
  assert.deepEqual(result.paths, ["README.md", "docs/guide.md"]);
});

test("classifies ordinary source as standard", async () => {
  const policy = await loadEngineeringPolicy({ repoRoot });
  assert.equal(
    classifyPaths({ repoRoot, paths: ["apps/web-widget/src/main.tsx"], policy }).classification,
    "standard",
  );
});

test("uses protected over standard over review-only precedence", async () => {
  const policy = await loadEngineeringPolicy({ repoRoot });
  const standardMixed = classifyPaths({
    repoRoot,
    paths: ["README.md", "apps/web-widget/src/main.tsx"],
    policy,
  });
  assert.equal(standardMixed.classification, "standard");

  const protectedMixed = classifyPaths({
    repoRoot,
    paths: ["README.md", "apps/web-widget/src/main.tsx", ".github/workflows/ci.yml"],
    policy,
  });
  assert.equal(protectedMixed.classification, "protected");
});

test("normalizes paths to deterministic repository-relative POSIX output", async () => {
  const policy = await loadEngineeringPolicy({ repoRoot });
  const result = classifyPaths({
    repoRoot,
    paths: ["apps\\web-widget\\src\\main.tsx", "README.md", "README.md"],
    policy,
  });
  assert.deepEqual(result.paths, ["README.md", "apps/web-widget/src/main.tsx"]);
  assert.deepEqual(result.matches.map((match) => match.path), result.paths);
});

test("fails closed for repository escapes and empty scope", async () => {
  const policy = await loadEngineeringPolicy({ repoRoot });
  assert.throws(() => classifyPaths({ repoRoot, paths: ["../secret.txt"], policy }), /outside repository/i);
  assert.throws(() => classifyPaths({ repoRoot, paths: [], policy }), /explicit scope/i);
});

test("fails closed for malformed and unreadable policy files", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "kidbot-policy-"));
  const malformedPath = path.join(tempRoot, "malformed.json");
  await writeFile(malformedPath, JSON.stringify({
    version: 1,
    rules: [{
      id: "all",
      classification: "standard",
      patterns: ["**"],
      requiresHumanReview: false,
    }],
    verification: {},
  }));
  await assert.rejects(
    loadEngineeringPolicy({ repoRoot, policyPath: malformedPath }),
    /verification/i,
  );
  await assert.rejects(
    loadEngineeringPolicy({ repoRoot, policyPath: path.join(tempRoot, "missing.json") }),
    /policy/i,
  );
});

test("rejects verification commands outside the secret-free repository allowlist", async () => {
  const basePolicy = await loadEngineeringPolicy({ repoRoot });
  for (const unsafeCommand of [
    "pnpm run smoke:production-widget-story-panels",
    "pnpm run deploy",
    "printenv",
    "node -e \"console.log(process.env)\"",
    "type .env",
  ]) {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "kidbot-policy-command-"));
    const policyPath = path.join(tempRoot, "policy.json");
    await writeFile(policyPath, JSON.stringify({
      ...basePolicy,
      verification: {
        ...basePolicy.verification,
        standard: [unsafeCommand],
      },
    }));
    await assert.rejects(
      loadEngineeringPolicy({ repoRoot, policyPath }),
      /verification command/i,
      unsafeCommand,
    );
  }
});
