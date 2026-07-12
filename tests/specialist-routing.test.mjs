import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  loadSpecialistRegistry,
  selectSpecialists,
} from "../scripts/engineering-policy.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");

async function createRegistryFixture(mutator = (registry) => registry) {
  const root = await mkdtemp(path.join(tmpdir(), "kidbot-specialists-"));
  const specialistsDirectory = path.join(root, ".agents", "specialists");
  await mkdir(specialistsDirectory, { recursive: true });
  const registry = mutator({
    version: 1,
    specialists: [
      {
        id: "tester",
        instructions: ".agents/specialists/tester.md",
        description: "Plan and assess verification coverage.",
        classifications: [],
        patterns: ["tests/**", "apps/**/src/**"],
      },
    ],
  });
  if (registry?.specialists) {
    for (const specialist of registry.specialists) {
      const instruction = specialist.instructions;
      if (typeof instruction === "string" && instruction.startsWith(".agents/specialists/") && instruction.endsWith(".md")) {
        await writeFile(path.join(root, ...instruction.split("/")), "# Contract\n");
      }
    }
  }
  const registryPath = path.join(root, ".agents", "specialists.json");
  await writeFile(registryPath, JSON.stringify(registry));
  return { root, registryPath };
}

test("loads the repository registry and selects tester and UI hardener deterministically", async () => {
  const registry = await loadSpecialistRegistry({ repoRoot });
  const selected = selectSpecialists({
    repoRoot,
    paths: ["apps/web-widget/src/components/ComicBoard.tsx"],
    classification: "standard",
    registry,
  });
  assert.deepEqual(selected.map(({ id }) => id), ["tester", "ui-hardener"]);
});

test("selects protected reviewer and path-sensitive safety reviewer", async () => {
  const registry = await loadSpecialistRegistry({ repoRoot });
  assert.deepEqual(selectSpecialists({ repoRoot, paths: ["scripts/engineering-policy.mjs"], classification: "protected", registry }).map(({ id }) => id), ["reviewer", "tester"]);
  for (const candidate of ["src/auth/token.ts", "src/moderation/check.ts", "src/story-schema.ts", "src/image-storage.ts", "src/permission-gate.ts"]) {
    assert.ok(selectSpecialists({ repoRoot, paths: [candidate], classification: "protected", registry }).some(({ id }) => id === "safety-reviewer"), candidate);
  }
});

test("selects test isolation for tests, fixtures, configuration, and CI wiring", async () => {
  const registry = await loadSpecialistRegistry({ repoRoot });
  for (const candidate of ["tests/unit.test.mjs", "tests/fixtures/story.json", "vitest.config.ts", ".github/workflows/ci.yml"]) {
    assert.ok(selectSpecialists({ repoRoot, paths: [candidate], classification: "protected", registry }).some(({ id }) => id === "test-isolation"), candidate);
  }
});

test("deduplicates mixed scope and sorts recommendations and reasons", async () => {
  const registry = await loadSpecialistRegistry({ repoRoot });
  const selected = selectSpecialists({ repoRoot, paths: ["tests/z.test.mjs", "tests/a.test.mjs", "tests/z.test.mjs"], classification: "protected", registry });
  assert.deepEqual(selected.map(({ id }) => id), [...selected.map(({ id }) => id)].sort());
  assert.equal(new Set(selected.map(({ id }) => id)).size, selected.length);
  for (const recommendation of selected) assert.deepEqual(recommendation.reasons, [...recommendation.reasons].sort());
});

test("does not select a specialist for unrelated documentation", async () => {
  const registry = await loadSpecialistRegistry({ repoRoot });
  assert.deepEqual(selectSpecialists({ repoRoot, paths: ["README.md"], classification: "review-only", registry }), []);
});

test("fails closed for malformed JSON", async () => {
  const { root, registryPath } = await createRegistryFixture();
  await writeFile(registryPath, "{");
  await assert.rejects(loadSpecialistRegistry({ repoRoot: root }), /specialist registry/i);
});

test("rejects unknown keys, duplicate IDs, and duplicate instruction paths", async () => {
  const mutations = [
    (registry) => ({ ...registry, extra: true }),
    (registry) => ({ ...registry, specialists: [{ ...registry.specialists[0], extra: true }] }),
    (registry) => ({ ...registry, specialists: [...registry.specialists, { ...registry.specialists[0] }] }),
    (registry) => ({ ...registry, specialists: [...registry.specialists, { ...registry.specialists[0], id: "other" }] }),
  ];
  for (const mutate of mutations) {
    const { root } = await createRegistryFixture(mutate);
    await assert.rejects(loadSpecialistRegistry({ repoRoot: root }), /specialist registry/i);
  }
});

test("rejects invalid classifications, patterns, and empty routing signals", async () => {
  const mutations = [
    (registry) => ({ ...registry, specialists: [{ ...registry.specialists[0], classifications: ["urgent"] }] }),
    (registry) => ({ ...registry, specialists: [{ ...registry.specialists[0], patterns: ["../outside/**"] }] }),
    (registry) => ({ ...registry, specialists: [{ ...registry.specialists[0], classifications: [], patterns: [] }] }),
  ];
  for (const mutate of mutations) {
    const { root } = await createRegistryFixture(mutate);
    await assert.rejects(loadSpecialistRegistry({ repoRoot: root }), /specialist registry/i);
  }
});

test("rejects missing, non-file, escaped, and absolute instructions", async () => {
  const missing = await createRegistryFixture();
  await rm(path.join(missing.root, ".agents", "specialists", "tester.md"));
  await assert.rejects(loadSpecialistRegistry({ repoRoot: missing.root }), /instructions/i);

  const nonFile = await createRegistryFixture();
  await mkdir(path.join(nonFile.root, ".agents", "specialists", "directory.md"));
  const directoryRegistry = JSON.parse(await import("node:fs/promises").then(({ readFile }) => readFile(nonFile.registryPath, "utf8")));
  directoryRegistry.specialists[0].instructions = ".agents/specialists/directory.md";
  await writeFile(nonFile.registryPath, JSON.stringify(directoryRegistry));
  await assert.rejects(loadSpecialistRegistry({ repoRoot: nonFile.root }), /regular file/i);

  for (const instructions of ["../outside.md", path.resolve(nonFile.root, "outside.md")]) {
    const fixture = await createRegistryFixture((registry) => ({ ...registry, specialists: [{ ...registry.specialists[0], instructions }] }));
    await assert.rejects(loadSpecialistRegistry({ repoRoot: fixture.root }), /instructions/i);
  }
});

test("rejects invalid selection classification and path escapes", async () => {
  const registry = await loadSpecialistRegistry({ repoRoot });
  assert.throws(() => selectSpecialists({ repoRoot, paths: ["README.md"], classification: "urgent", registry }), /classification/i);
  assert.throws(() => selectSpecialists({ repoRoot, paths: ["../outside.md"], classification: "standard", registry }), /outside repository/i);
});
