import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const zeroSha = '0000000000000000000000000000000000000000';
const safeRef = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/u;

export async function resolveHarnessBase({ repoRoot, eventName, baseRef, before } = {}) {
  if (typeof repoRoot !== 'string' || repoRoot.length === 0) throw new Error('Repository root is required');
  let candidate;
  if (eventName === 'pull_request') {
    if (typeof baseRef !== 'string' || !safeRef.test(baseRef) || baseRef.includes('..') || baseRef.endsWith('/')) {
      throw new Error('Pull request base ref is empty or unsafe');
    }
    candidate = `origin/${baseRef}`;
  } else if (eventName === 'push') {
    if (typeof before !== 'string' || before.length === 0 || before === zeroSha || !/^[0-9a-f]{40}$/iu.test(before)) {
      throw new Error('Push base is empty, zero, or invalid');
    }
    candidate = before;
  } else {
    throw new Error(`Unsupported event for harness base: ${eventName || '<empty>'}`);
  }
  try {
    await execFileAsync('git', ['rev-parse', '--verify', `${candidate}^{commit}`], {
      cwd: repoRoot,
      windowsHide: true,
    });
  } catch (error) {
    throw new Error(`Harness base does not resolve to a Git commit: ${candidate}`, { cause: error });
  }
  return candidate;
}

async function main() {
  try {
    const candidate = await resolveHarnessBase({
      repoRoot: process.cwd(),
      eventName: process.env.EVENT_NAME,
      baseRef: process.env.BASE_REF,
      before: process.env.BEFORE_SHA,
    });
    process.stdout.write(`HARNESS_BASE=${candidate}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) await main();
