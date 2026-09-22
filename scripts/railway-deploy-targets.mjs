#!/usr/bin/env node
/**
 * Which services a push should redeploy, from the committed Railway watch
 * patterns.
 *
 * The deploy gate cannot assume every push advances both services: with watch
 * patterns configured, a docs-only push redeploys neither and an app-specific
 * push redeploys one. Requiring the new commit from a service that was never
 * going to rebuild turns a healthy production into a red check.
 *
 * When a service has no watch patterns, Railway rebuilds it on every push to
 * the tracked branch, so it is always a target.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const serviceConfigPaths = Object.freeze({
  agent: path.join('apps', 'agent-service', 'railway.json'),
  mcp: path.join('apps', 'mcp-server', 'railway.json'),
});

export const serviceNames = Object.freeze(Object.keys(serviceConfigPaths));

/** `**` crosses directory separators, `*` does not. */
export const watchPatternToRegExp = (pattern) => {
  let source = '^';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        source += '.*';
        i += 1;
        if (pattern[i + 1] === '/') i += 1;
      } else {
        source += '[^/]*';
      }
    } else if ('\\^$.|?+()[]{}'.includes(char)) {
      source += `\\${char}`;
    } else {
      source += char;
    }
  }
  return new RegExp(`${source}$`);
};

export const matchesAnyWatchPattern = (file, patterns) => {
  const normalized = file.split(path.sep).join('/').replace(/^\.\//, '');
  return patterns.some((pattern) => watchPatternToRegExp(pattern).test(normalized));
};

export const readWatchPatterns = async ({ repoRoot, configPath }) => {
  try {
    const parsed = JSON.parse(await readFile(path.resolve(repoRoot, configPath), 'utf8'));
    const patterns = parsed?.build?.watchPatterns;
    return Array.isArray(patterns) && patterns.length > 0 ? patterns : undefined;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return undefined;
    }
    throw new Error(`Invalid Railway config at ${configPath}: ${error.message}`);
  }
};

/**
 * Services that should report the new commit. `files` of `undefined` means the
 * change set is unknown, which requires every service: an unknown diff must not
 * silently weaken the gate.
 */
export const deployTargets = ({ files, watchPatterns }) => {
  const targets = [];
  for (const service of serviceNames) {
    const patterns = watchPatterns[service];
    if (!patterns || !Array.isArray(files)) {
      targets.push(service);
      continue;
    }
    if (files.some((file) => matchesAnyWatchPattern(file, patterns))) {
      targets.push(service);
    }
  }
  return targets;
};

export const resolveDeployTargets = async ({ repoRoot, files }) => {
  const watchPatterns = {};
  for (const service of serviceNames) {
    watchPatterns[service] = await readWatchPatterns({
      repoRoot,
      configPath: serviceConfigPaths[service],
    });
  }
  return deployTargets({ files, watchPatterns });
};

const main = async () => {
  const args = process.argv.slice(2);
  const unknownIndex = args.indexOf('--unknown-changes');
  const files = unknownIndex >= 0
    ? undefined
    : args.filter((value) => value !== '--').filter(Boolean);
  const repoRoot = path.resolve(import.meta.dirname, '..');
  const targets = await resolveDeployTargets({ repoRoot, files });
  process.stdout.write(`${targets.join(',')}\n`);
};

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
