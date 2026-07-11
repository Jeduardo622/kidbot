import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "..");
const cliPath = path.join(repoRoot, "scripts", "route-task.mjs");

async function runCli(args, { cwd = repoRoot } = {}) {
  try {
    const result = await execFileAsync(process.execPath, [cliPath, ...args], { cwd });
    return { code: 0, ...result };
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

async function git(cwd, ...args) {
  return execFileAsync("git", args, { cwd });
}

async function createGitRepo() {
  const root = await mkdtemp(path.join(tmpdir(), "kidbot-route-task-"));
  await mkdir(path.join(root, ".agents"));
  await writeFile(path.join(root, ".agents", "engineering-policy.json"), JSON.stringify({
    version: 1,
    rules: [
      { id: "protected", classification: "protected", patterns: ["package.json"], requiresHumanReview: true },
      { id: "review", classification: "review-only", patterns: ["**/*.md", "*.md"], requiresHumanReview: false },
      { id: "standard", classification: "standard", patterns: ["**/*.mjs", "*.mjs"], requiresHumanReview: false },
    ],
    verification: {
      "review-only": [],
      standard: ["pnpm test"],
      protected: ["pnpm run verify:local"],
    },
  }));
  await git(root, "init");
  await git(root, "config", "user.email", "router@example.test");
  await git(root, "config", "user.name", "Router Test");
  await writeFile(path.join(root, "README.md"), "base\n");
  await writeFile(path.join(root, "tracked.mjs"), "export const base = true;\n");
  await writeFile(path.join(root, "deleted.mjs"), "delete me\n");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "base");
  return root;
}

test("classifies explicit protected scope and emits stable JSON", async () => {
  const first = await runCli(["--json", "package.json"]);
  const second = await runCli(["--json", "package.json"]);
  assert.equal(first.code, 0, first.stderr);
  assert.equal(first.stdout, second.stdout);
  assert.deepEqual(JSON.parse(first.stdout), {
    classification: "protected",
    paths: ["package.json"],
    matchedRuleIds: ["protected-engineering-surfaces", "standard-repository-content"],
    commands: ["pnpm run verify:local"],
    requiresHumanReview: true,
  });
});

test("classifies explicit review-only scope", async () => {
  const result = await runCli(["README.md"]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /classification: review-only/);
  assert.match(result.stdout, /paths: README\.md/);
  assert.match(result.stdout, /human review: not required/);
});

test("accepts the pnpm argument separator before options", async () => {
  const result = await runCli(["--", "--json", "README.md"]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).classification, "review-only");
});

test("rejects invalid options, repository-external paths, and mixed base mode", async () => {
  for (const args of [
    ["--unknown"],
    ["../outside.mjs"],
    ["--base", "HEAD", "README.md"],
    ["--base"],
  ]) {
    const result = await runCli(args);
    assert.equal(result.code, 2, `${args.join(" ")}: ${result.stderr}`);
  }
});

test("reports missing bases and empty implicit scope as unresolved", async () => {
  const root = await createGitRepo();
  const missing = await runCli(["--base", "missing-ref"], { cwd: root });
  assert.equal(missing.code, 3, missing.stderr);
  const empty = await runCli([], { cwd: root });
  assert.equal(empty.code, 3, empty.stderr);
});

test("resolves committed, staged, unstaged, and deleted Git paths deterministically", async () => {
  const root = await createGitRepo();
  const { stdout: base } = await git(root, "rev-parse", "HEAD");
  await writeFile(path.join(root, "committed.mjs"), "export const committed = true;\n");
  await git(root, "add", "committed.mjs");
  await git(root, "commit", "-m", "head change");
  await writeFile(path.join(root, "staged.mjs"), "export const staged = true;\n");
  await git(root, "add", "staged.mjs");
  await writeFile(path.join(root, "tracked.mjs"), "export const changed = true;\n");
  await git(root, "rm", "deleted.mjs");

  const result = await runCli(["--base", base.trim(), "--json"], { cwd: root });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).paths, [
    "committed.mjs",
    "deleted.mjs",
    "staged.mjs",
    "tracked.mjs",
  ]);
});
