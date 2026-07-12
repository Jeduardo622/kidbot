import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  parseArguments,
  runCli,
  verifyChange,
} from "../scripts/verify-change.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");

function recordingRunner(statuses = []) {
  const commands = [];
  const run = (command, options) => {
    commands.push({ command, options });
    return { status: statuses.shift() ?? 0 };
  };
  return {
    commands,
    run,
  };
}

test("selects policy commands for review-only, standard, and protected scopes", async () => {
  for (const [candidate, classification, commands, requiresHumanReview] of [
    ["README.md", "review-only", ["pnpm run test:harness"], false],
    ["apps/web-widget/src/main.tsx", "standard", ["pnpm run lint", "pnpm run typecheck", "pnpm test", "pnpm --filter @kidbot/mcp-server run test:compat"], false],
    ["package.json", "protected", ["pnpm run verify:local"], true],
  ]) {
    const runner = recordingRunner();
    const report = await verifyChange({ repoRoot, explicitPaths: [candidate], runCommand: runner.run });
    assert.equal(report.classification, classification);
    assert.deepEqual(report.commands, commands);
    assert.equal(report.requiresHumanReview, requiresHumanReview);
    assert.deepEqual(runner.commands.map(({ command }) => command), commands);
  }
});

test("protected changes always escalate to verify:local and human review", async () => {
  const runner = recordingRunner();
  const report = await verifyChange({
    repoRoot,
    explicitPaths: ["README.md", "scripts/route-task.mjs", ".github/workflows/ci.yml"],
    runCommand: runner.run,
  });
  assert.equal(report.classification, "protected");
  assert.deepEqual(report.commands, ["pnpm run verify:local"]);
  assert.equal(report.requiresHumanReview, true);
});

test("review-only runs focused verification and propagates failure", async () => {
  const runner = recordingRunner([6]);
  const report = await verifyChange({ repoRoot, explicitPaths: ["README.md"], runCommand: runner.run });
  assert.deepEqual(runner.commands.map(({ command }) => command), ["pnpm run test:harness"]);
  assert.equal(report.status, 6);
  assert.equal(report.passed, false);
});

test("classification callback cannot append or replace validated commands or report fields", async () => {
  const runner = recordingRunner();
  const report = await verifyChange({
    repoRoot,
    explicitPaths: ["apps/web-widget/src/main.tsx"],
    runCommand: runner.run,
    onClassified(view) {
      for (const mutate of [
        () => view.commands.push("pnpm run deploy"),
        () => { view.commands = ["pnpm run deploy"]; },
        () => { view.classification = "review-only"; },
        () => { view.requiresHumanReview = true; },
      ]) {
        try { mutate(); } catch {}
      }
    },
  });
  assert.deepEqual(runner.commands.map(({ command }) => command), ["pnpm run lint", "pnpm run typecheck", "pnpm test", "pnpm --filter @kidbot/mcp-server run test:compat"]);
  assert.equal(report.classification, "standard");
  assert.deepEqual(report.commands, ["pnpm run lint", "pnpm run typecheck", "pnpm test", "pnpm --filter @kidbot/mcp-server run test:compat"]);
  assert.equal(report.requiresHumanReview, false);
});

test("classification callback cannot clear protected verification or human review", async () => {
  const runner = recordingRunner();
  const report = await verifyChange({
    repoRoot,
    explicitPaths: ["package.json"],
    runCommand: runner.run,
    onClassified(view) {
      for (const mutate of [
        () => { view.commands.length = 0; },
        () => { view.commands = []; },
        () => { view.requiresHumanReview = false; },
      ]) {
        try { mutate(); } catch {}
      }
    },
  });
  assert.deepEqual(runner.commands.map(({ command }) => command), ["pnpm run verify:local"]);
  assert.equal(report.classification, "protected");
  assert.deepEqual(report.commands, ["pnpm run verify:local"]);
  assert.equal(report.requiresHumanReview, true);
});

test("stops on first failure and propagates its status", async () => {
  const root = await createRepo({ commands: ["pnpm test", "pnpm run verify:local"] });
  const runner = recordingRunner([7, 0]);
  const report = await verifyChange({ repoRoot: root, explicitPaths: ["change.mjs"], runCommand: runner.run });
  assert.equal(report.status, 7);
  assert.equal(report.passed, false);
  assert.deepEqual(runner.commands.map(({ command }) => command), ["pnpm test"]);
});

test("runner inherits stdio and environment without logging environment values", async () => {
  const runner = recordingRunner();
  const secret = process.env.VERIFY_CHANGE_TEST_SECRET;
  process.env.VERIFY_CHANGE_TEST_SECRET = "do-not-print-this";
  try {
    await verifyChange({ repoRoot, explicitPaths: ["apps/web-widget/src/main.tsx"], runCommand: runner.run });
    assert.equal(runner.commands[0].options.shell, true);
    assert.equal(runner.commands[0].options.stdio, "inherit");
    assert.equal(runner.commands[0].options.env, process.env);
  } finally {
    if (secret === undefined) delete process.env.VERIFY_CHANGE_TEST_SECRET;
    else process.env.VERIFY_CHANGE_TEST_SECRET = secret;
  }
});

test("fails closed when no scope can be resolved", async () => {
  const root = await createRepo();
  await assert.rejects(verifyChange({ repoRoot: root, runCommand: recordingRunner().run }), /scope/i);
});

test("CLI reports classification, commands, status, human review, and propagates exit status", async () => {
  const stdout = capture();
  const stderr = capture();
  const runner = recordingRunner([9]);
  const status = await runCli({
    argv: ["apps/web-widget/src/main.tsx"],
    repoRoot,
    stdout,
    stderr,
    runCommand: runner.run,
  });
  assert.equal(status, 9);
  assert.match(stdout.value, /classification: standard/);
  assert.match(stdout.value, /command: pnpm run lint/);
  assert.match(stdout.value, /status: failed \(9\)/);
  assert.match(stdout.value, /human review: not required/);
  assert.equal(stderr.value, "");
});

test("CLI accepts pnpm separator and rejects missing scope with nonzero status", async () => {
  assert.deepEqual(parseArguments(["--", "--base", "HEAD"]), { base: "HEAD", explicitPaths: [] });
  const root = await createRepo();
  const stderr = capture();
  const status = await runCli({ argv: [], repoRoot: root, stdout: capture(), stderr, runCommand: recordingRunner().run });
  assert.equal(status, 3);
  assert.match(stderr.value, /scope/i);
});

test("policy validation prevents production commands and CLI output does not log environment", async () => {
  const root = await createRepo({ commands: ["pnpm run deploy"] });
  const stdout = capture();
  const stderr = capture();
  process.env.VERIFY_CHANGE_SENTINEL = "never-print-this";
  try {
    const status = await runCli({ argv: ["change.mjs"], repoRoot: root, stdout, stderr, runCommand: recordingRunner().run });
    assert.equal(status, 3);
    assert.doesNotMatch(`${stdout.value}${stderr.value}`, /never-print-this/);
    assert.match(stderr.value, /not permitted/i);
  } finally {
    delete process.env.VERIFY_CHANGE_SENTINEL;
  }
});

function capture() {
  return { value: "", write(chunk) { this.value += chunk; } };
}

async function createRepo({ commands = ["pnpm test"] } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "kidbot-verify-change-"));
  await mkdir(path.join(root, ".agents"));
  await writeFile(path.join(root, "change.mjs"), "export const changed = true;\n");
  await writeFile(path.join(root, ".agents", "engineering-policy.json"), JSON.stringify({
    version: 1,
    rules: [{ id: "standard", classification: "standard", patterns: ["*.mjs"], requiresHumanReview: false }],
    verification: { "review-only": [], standard: commands, protected: ["pnpm run verify:local"] },
  }));
  return root;
}
