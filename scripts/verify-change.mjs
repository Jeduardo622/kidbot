import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  classifyPaths,
  loadEngineeringPolicy,
  resolveScope,
  TaskInputError,
} from "./engineering-policy.mjs";

class ArgumentError extends TaskInputError {}

export function parseArguments(argv) {
  const options = { base: undefined, explicitPaths: [] };
  const startIndex = argv[0] === "--" ? 1 : 0;
  for (let index = startIndex; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--base") {
      if (options.base !== undefined) throw new ArgumentError("--base may only be supplied once");
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new ArgumentError("--base requires a Git ref");
      options.base = value;
      index += 1;
    } else if (argument.startsWith("--")) {
      throw new ArgumentError(`unknown option: ${argument}`);
    } else {
      options.explicitPaths.push(argument);
    }
  }
  if (options.base !== undefined && options.explicitPaths.length > 0) {
    throw new ArgumentError("--base cannot be combined with explicit paths");
  }
  return options;
}

function defaultRunCommand(command, options) {
  return spawnSync(command, options);
}

function immutableClassification(source) {
  return Object.freeze({
    classification: source.classification,
    paths: Object.freeze([...source.paths]),
    matches: Object.freeze(source.matches.map((match) => Object.freeze({
      path: match.path,
      rules: Object.freeze([...match.rules]),
      classification: match.classification,
    }))),
    commands: Object.freeze([...source.commands]),
    requiresHumanReview: source.requiresHumanReview,
  });
}

export async function verifyChange({ repoRoot, base, explicitPaths, runCommand = defaultRunCommand, onClassified, onCommand } = {}) {
  const resolvedRoot = path.resolve(repoRoot ?? process.cwd());
  const paths = await resolveScope({ repoRoot: resolvedRoot, base, explicitPaths });
  const policy = await loadEngineeringPolicy({ repoRoot: resolvedRoot });
  let routed;
  try {
    routed = classifyPaths({ repoRoot: resolvedRoot, paths, policy });
  } catch (error) {
    if (explicitPaths?.length) throw new TaskInputError(error.message, { cause: error });
    throw error;
  }
  const classification = immutableClassification(routed);
  onClassified?.(immutableClassification(classification));

  const executedCommands = [];
  let status = 0;
  for (const command of classification.commands) {
    onCommand?.(command);
    const result = runCommand(command, {
      cwd: resolvedRoot,
      shell: true,
      stdio: "inherit",
      env: process.env,
    });
    status = Number.isInteger(result?.status) ? result.status : 1;
    executedCommands.push({ command, status });
    if (status !== 0) break;
  }

  return {
    ...classification,
    executedCommands,
    status,
    passed: status === 0,
  };
}

export async function runCli({
  argv = process.argv.slice(2),
  repoRoot = process.cwd(),
  stdout = process.stdout,
  stderr = process.stderr,
  runCommand = defaultRunCommand,
} = {}) {
  try {
    const options = parseArguments(argv);
    const report = await verifyChange({
      repoRoot,
      base: options.base,
      explicitPaths: options.explicitPaths.length ? options.explicitPaths : undefined,
      runCommand,
      onClassified(routed) {
        stdout.write(`classification: ${routed.classification}\npaths: ${routed.paths.join(", ")}\n`);
        if (routed.commands.length === 0) stdout.write("command: none\n");
      },
      onCommand(command) {
        stdout.write(`command: ${command}\n`);
      },
    });
    const suffix = [
      `status: ${report.passed ? "passed" : `failed (${report.status})`}`,
      `human review: ${report.requiresHumanReview ? "required" : "not required"}`,
      "verification evidence only: no deployment, merge, or secret authorization granted",
      "",
    ];
    stdout.write(`${suffix.join("\n")}\n`);
    return report.status;
  } catch (error) {
    const invalid = error instanceof TaskInputError;
    stderr.write(`${invalid ? "Invalid arguments or paths" : "Unable to verify change"}: ${error.message}\n`);
    return invalid ? 2 : 3;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await runCli();
}
