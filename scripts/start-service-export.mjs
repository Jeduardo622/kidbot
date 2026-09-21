import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const entry = process.argv[2];
if (!entry) {
  throw new Error('Usage: node scripts/start-service-export.mjs <service-entry>');
}

const serviceModule = await import(pathToFileURL(resolve(entry)).href);
if (typeof serviceModule.start !== 'function') {
  throw new Error(`Service entry does not export start(): ${entry}`);
}

serviceModule.start();
