import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveFixturesDir } from '../fixtures.js';

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('fixtures directory resolution', () => {
  it('resolves to the repository fixtures directory from src and dist', () => {
    const fromSrc = resolveFixturesDir(srcDir);
    const fromDist = resolveFixturesDir(path.resolve(srcDir, '../dist'));
    expect(fromSrc).toEqual(fromDist);
    expect(fromSrc).toEqual(path.resolve(srcDir, '../../../fixtures'));
    expect(existsSync(fromSrc)).toBe(true);
  });

  it('finds every fixture the stub handlers read', () => {
    const dir = resolveFixturesDir(srcDir);
    for (const file of ['voice/moon.json', 'comics/dragon4.json', 'coloring/space-cat.svg', 'science/buoyancy.json']) {
      expect(existsSync(path.join(dir, file)), file).toBe(true);
    }
  });
});
