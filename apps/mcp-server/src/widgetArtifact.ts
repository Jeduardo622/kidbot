import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Mode } from './types.js';

export interface WidgetArtifactStatus {
  distReady: boolean;
  fallbackReady: boolean;
  indexHtml: string | null;
  javascriptAsset: string | null;
  stylesheetAsset: string | null;
}

export const renderWidgetDocument = ({
  css,
  javascript,
}: {
  css: string;
  javascript: string;
}) => `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Kidbot Widget</title><style>${css}</style></head><body><div id="kidbot-root"></div><script type="module">${javascript}</script></body></html>`;

const isNonEmptyFile = (filePath: string) => {
  try {
    const status = statSync(filePath);
    return status.isFile() && status.size > 0;
  } catch {
    return false;
  }
};

const readAttribute = (tag: string, attribute: string) => {
  const match = tag.match(new RegExp(`\\b${attribute}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
  return match?.[2] ?? null;
};

const normalizeLocalAsset = (
  distDir: string,
  reference: string,
  extension: '.js' | '.css',
): string | null => {
  let decoded: string;
  try {
    decoded = decodeURIComponent(reference);
  } catch {
    return null;
  }
  if (
    decoded.includes('\\')
    || decoded.includes('?')
    || decoded.includes('#')
    || decoded.startsWith('/')
    || /^[a-z][a-z\d+.-]*:/i.test(decoded)
  ) {
    return null;
  }
  const normalized = decoded.replace(/^\.\//, '');
  const segments = normalized.split('/');
  if (
    segments[0] !== 'assets'
    || segments.some((segment) => segment === '' || segment === '.' || segment === '..')
    || !normalized.endsWith(extension)
  ) {
    return null;
  }
  return isNonEmptyFile(path.join(distDir, ...segments)) ? normalized : null;
};

export const inspectWidgetArtifact = (distDir: string): WidgetArtifactStatus => {
  const indexPath = path.join(distDir, 'index.html');
  const indexHtml = isNonEmptyFile(indexPath) ? 'index.html' : null;
  let javascriptAsset: string | null = null;
  let stylesheetAsset: string | null = null;
  let referencedAssetsReady = false;
  if (indexHtml) {
    const html = readFileSync(indexPath, 'utf8');
    const scriptReferences = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1[^>]*>/gi)]
      .map((match) => match[2])
      .filter((reference): reference is string => typeof reference === 'string');
    const stylesheetReferences = [...html.matchAll(/<link\b[^>]*>/gi)]
      .filter((match) => (readAttribute(match[0], 'rel') ?? '').split(/\s+/).includes('stylesheet'))
      .map((match) => readAttribute(match[0], 'href'));
    const scripts = scriptReferences.map((reference) => normalizeLocalAsset(distDir, reference, '.js'));
    const stylesheets = stylesheetReferences.map((reference) =>
      reference ? normalizeLocalAsset(distDir, reference, '.css') : null);
    referencedAssetsReady = scripts.length > 0
      && stylesheets.length > 0
      && scripts.every(Boolean)
      && stylesheets.every(Boolean);
    javascriptAsset = referencedAssetsReady ? scripts[0] ?? null : null;
    stylesheetAsset = referencedAssetsReady ? stylesheets[0] ?? null : null;
  }
  const fallbackReady = [
    'kidbot-fallback.html',
    'kidbot-fallback.css',
    'kidbot-fallback.js',
  ].every((file) => isNonEmptyFile(path.join(distDir, file)));

  return {
    distReady: Boolean(indexHtml && referencedAssetsReady),
    fallbackReady,
    indexHtml,
    javascriptAsset,
    stylesheetAsset,
  };
};

export const resolveWidgetMode = ({
  artifact,
  fallbackRequested,
  nodeEnv,
}: {
  artifact: WidgetArtifactStatus;
  fallbackRequested: boolean;
  nodeEnv: string | undefined;
}): Mode => {
  if (fallbackRequested) {
    if (nodeEnv === 'production') {
      throw new Error('Offline fallback widget is not allowed in production.');
    }
    if (!artifact.fallbackReady) {
      throw new Error('Offline fallback widget assets are incomplete.');
    }
    return 'fallback';
  }
  if (artifact.distReady) {
    return 'dist';
  }
  if (nodeEnv === 'production') {
    throw new Error(
      'Production widget distribution is incomplete. Build apps/web-widget before starting MCP.',
    );
  }
  return 'fallback';
};

export const assertProductionWidgetArtifact = (distDir: string): WidgetArtifactStatus => {
  const artifact = inspectWidgetArtifact(distDir);
  resolveWidgetMode({ artifact, fallbackRequested: false, nodeEnv: 'production' });
  return artifact;
};

const isEntrypoint = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isEntrypoint) {
  const distDir = path.resolve(process.argv[2] ?? 'apps/web-widget/dist');
  const artifact = assertProductionWidgetArtifact(distDir);
  process.stdout.write(`widget artifact: ready (${artifact.javascriptAsset})\n`);
}
