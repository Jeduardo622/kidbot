import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  classifyPaths,
  loadEngineeringPolicy,
  loadSpecialistRegistry,
  resolveScope,
  selectSpecialists,
  TaskInputError,
} from "./engineering-policy.mjs";

class ArgumentError extends TaskInputError {}

export function parseArguments(argv) {
  const options = { base: undefined, json: false, explicitPaths: [] };
  const startIndex = argv[0] === "--" ? 1 : 0;
  for (let index = startIndex; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") {
      options.json = true;
    } else if (argument === "--base") {
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

export function formatResult(result, { json = false } = {}) {
  const output = {
    classification: result.classification,
    paths: result.paths,
    matchedRuleIds: [...new Set(result.matches.flatMap((match) => match.rules))].sort(),
    commands: result.commands,
    requiresHumanReview: result.requiresHumanReview,
    specialists: result.specialists,
  };
  if (json) return `${JSON.stringify(output, null, 2)}\n`;
  return [
    `classification: ${output.classification}`,
    `paths: ${output.paths.join(", ")}`,
    `matched rules: ${output.matchedRuleIds.join(", ")}`,
    `commands: ${output.commands.length ? output.commands.join(", ") : "none"}`,
    `human review: ${output.requiresHumanReview ? "required" : "not required"}`,
    ...(output.specialists.length
      ? output.specialists.map((specialist) => `specialist: ${specialist.id} (${specialist.reasons.join(",")}) -> ${specialist.instructions}`)
      : ["specialists: none"]),
    "",
  ].join("\n");
}

export async function routeTask({ argv = [], repoRoot = process.cwd() } = {}) {
  const options = parseArguments(argv);
  const paths = await resolveScope({
    repoRoot,
    base: options.base,
    explicitPaths: options.explicitPaths.length ? options.explicitPaths : undefined,
  });
  const policy = await loadEngineeringPolicy({ repoRoot });
  const registry = await loadSpecialistRegistry({ repoRoot });
  try {
    const result = classifyPaths({ repoRoot, paths, policy });
    return {
      result: {
        ...result,
        specialists: selectSpecialists({
          repoRoot,
          paths: result.paths,
          classification: result.classification,
          registry,
        }),
      },
      json: options.json,
    };
  } catch (error) {
    if (options.explicitPaths.length > 0) throw new TaskInputError(error.message, { cause: error });
    throw error;
  }
}

export async function runCli({ argv = process.argv.slice(2), repoRoot = process.cwd(), stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    const routed = await routeTask({ argv, repoRoot: path.resolve(repoRoot) });
    stdout.write(formatResult(routed.result, { json: routed.json }));
    return 0;
  } catch (error) {
    const invalid = error instanceof TaskInputError;
    stderr.write(`${invalid ? "Invalid arguments or paths" : "Unable to resolve scope"}: ${error.message}\n`);
    return invalid ? 2 : 3;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await runCli();
}
