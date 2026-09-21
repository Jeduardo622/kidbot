import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import path from 'node:path';
import type { ImageAssetStorageConfig } from './imageAssetStore.js';

// Configuration is validated at startup. This probes dependencies, not paid generation.
// A public bucket is required by the current public-URL image contract.
export const readImageStorageReadiness = async (
  config: ImageAssetStorageConfig,
  fetcher: typeof fetch = fetch,
): Promise<{ mode: ImageAssetStorageConfig['mode']; ready: boolean }> => {
  let ready = false;
  try {
    if (config.mode === 'data-url') {
      ready = true;
    } else if (config.mode === 'local') {
      let directory = path.resolve(config.directory);
      // First upload creates the directory; inspect its nearest existing ancestor.
      while (true) {
        try {
          if (!(await stat(directory)).isDirectory()) break;
          await access(directory, constants.W_OK);
          ready = true;
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') break;
          const parent = path.dirname(directory);
          if (directory === parent) break;
          directory = parent;
        }
      }
    } else if (config.supabaseUrl && config.supabaseBucket && config.supabaseServiceRoleKey) {
      const response = await fetcher(
        `${config.supabaseUrl}/storage/v1/bucket/${encodeURIComponent(config.supabaseBucket)}`,
        {
          method: 'GET',
          headers: { apikey: config.supabaseServiceRoleKey, Authorization: `Bearer ${config.supabaseServiceRoleKey}` },
          signal: AbortSignal.timeout(2_000),
        },
      );
      if (response.ok) {
        const body = await response.json() as { id?: unknown; public?: unknown };
        ready = body.id === config.supabaseBucket && body.public === true;
      }
    }
  } catch {
    // Never return upstream bodies, URLs, credentials or raw dependency errors.
  }
  return { mode: config.mode, ready };
};
