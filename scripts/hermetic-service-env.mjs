import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const hostEnvironmentKeys = new Set([
  'COMSPEC',
  'HOMEDRIVE',
  'HOMEPATH',
  'LANG',
  'LC_ALL',
  'PATH',
  'PATHEXT',
  'SYSTEMDRIVE',
  'SYSTEMROOT',
  'TEMP',
  'TMP',
  'WINDIR',
]);

const copyHostEnvironment = (processEnv) => {
  const env = {};
  for (const [key, value] of Object.entries(processEnv)) {
    if (value !== undefined && hostEnvironmentKeys.has(key.toUpperCase())) {
      env[key] = value;
    }
  }
  return env;
};

export const createHermeticServiceContext = async ({
  processEnv = process.env,
  overrides = {},
} = {}) => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'kidbot-hermetic-service-'));
  const env = {
    ...copyHostEnvironment(processEnv),
    ...overrides,
    DOTENV_CONFIG_PATH: path.join(cwd, 'kidbot-no-env'),
    DOTENV_CONFIG_QUIET: 'true',
  };
  let cleaned = false;
  return {
    cwd,
    env,
    cleanup: async () => {
      if (cleaned) return;
      cleaned = true;
      await rm(cwd, { force: true, recursive: true });
    },
  };
};
