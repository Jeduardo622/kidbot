import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const classifications = new Set(['review-only', 'standard', 'protected']);

export function parseHarnessClassification(output) {
  if (typeof output !== 'string' || output.trim().length === 0) throw new Error('Router output is empty');
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch (error) {
    throw new Error('Router output is not valid JSON', { cause: error });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !classifications.has(parsed.classification)) {
    throw new Error('Router output has a missing or invalid classification');
  }
  return parsed.classification;
}

async function main() {
  try {
    const file = process.argv[2];
    if (!file) throw new Error('Router output file is required');
    const classification = parseHarnessClassification(await readFile(file, 'utf8'));
    process.stdout.write(`HARNESS_CLASSIFICATION=${classification}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) await main();
