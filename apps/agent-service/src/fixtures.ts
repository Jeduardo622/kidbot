import path from 'path';

/**
 * Fixture files live at the repository root (`<repo>/fixtures`). Both the
 * TypeScript source (`apps/agent-service/src`) and the compiled output
 * (`apps/agent-service/dist`) sit three directories below that root.
 */
export const resolveFixturesDir = (fromDir: string): string =>
  path.resolve(fromDir, '../../../fixtures');
