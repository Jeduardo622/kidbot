import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { readFileSync, readdirSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { registerTools } from './tools.js';
import type { Mode } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const mcpServer = new McpServer({ name: 'kidbot-mcp', version: '0.1.0' });
registerTools(mcpServer);

const widgetResourceUri = 'ui://widget/kidbot.html';

const distDir = path.resolve(__dirname, '../../web-widget/dist');
const assetsDir = path.join(distDir, 'assets');
const fallbackHtmlPath = path.join(distDir, 'kidbot-fallback.html');
const fallbackCssPath = path.join(distDir, 'kidbot-fallback.css');
const fallbackJsPath = path.join(distDir, 'kidbot-fallback.js');

const hasBundle = existsSync(distDir) && existsSync(assetsDir) && readdirSync(assetsDir).some((file) => file.endsWith('.js'));
const fallbackRequested = process.env.FALLBACK_WIDGET === '1';
const fallbackAvailable = existsSync(fallbackHtmlPath);

const resolveFallbackHtml = (): string => {
  if (!fallbackAvailable) {
    return '<!doctype html><html><body><div id="kidbot-root">Fallback widget missing. Ensure apps/web-widget/dist/kidbot-fallback.html exists.</div></body></html>';
  }

  let html = readFileSync(fallbackHtmlPath, 'utf-8');
  if (existsSync(fallbackCssPath)) {
    const css = readFileSync(fallbackCssPath, 'utf-8');
    html = html.replace('<link rel="stylesheet" href="./kidbot-fallback.css" />', `<style>${css}</style>`);
  }
  if (existsSync(fallbackJsPath)) {
    const js = readFileSync(fallbackJsPath, 'utf-8');
    html = html.replace('<script src="./kidbot-fallback.js"></script>', `<script>${js}</script>`);
  }
  return html;
};

const resolveDistHtml = (): string => {
  if (!hasBundle) {
    return resolveFallbackHtml();
  }

  const assetFiles = readdirSync(assetsDir);
  const jsFile = assetFiles.find((file) => file.endsWith('.js'));
  const cssFile = assetFiles.find((file) => file.endsWith('.css'));

  const jsContent = jsFile ? readFileSync(path.join(assetsDir, jsFile), 'utf-8') : '';
  const cssContent = cssFile ? readFileSync(path.join(assetsDir, cssFile), 'utf-8') : '';

  return `<!doctype html><html><head><meta charset="utf-8"/><title>KidBot Widget</title><style>${cssContent}</style></head><body><div id="kidbot-root"></div><script type="module">${jsContent}</script></body></html>`;
};

const widgetMode: Mode = fallbackRequested || !hasBundle ? 'fallback' : 'dist';
const widgetHtml = widgetMode === 'fallback' ? resolveFallbackHtml() : resolveDistHtml();

const resourceRegistrar = mcpServer as unknown as {
  registerResource?: (resource: { uri: string; mimeType: string; data: string; metadata?: Record<string, unknown> }) => void;
  resource?: (resource: { uri: string; mimeType: string; data: string; metadata?: Record<string, unknown> }) => void;
};

const registerResource = resourceRegistrar.resource ?? resourceRegistrar.registerResource;
if (typeof registerResource === 'function') {
  registerResource({
    uri: widgetResourceUri,
    mimeType: 'text/html+skybridge',
    data: widgetHtml,
    metadata: {
      'openai/widgetDescription': 'KidBot — safe creative play: voice, comics, coloring, science.',
      'openai/widgetCSP': { connect_domains: [], resource_domains: [] },
      mode: widgetMode
    }
  });
}

const fixturesDir = path.resolve(__dirname, '../../../fixtures');
if (existsSync(fixturesDir)) {
  app.use('/fixtures', express.static(fixturesDir));
}

if (existsSync(distDir)) {
  app.use('/widget', express.static(distDir));
}

const publicDir = path.resolve(__dirname, '../public');
if (existsSync(publicDir)) {
  app.use('/public', express.static(publicDir));
}

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, mode: widgetMode, time: new Date().toISOString() });
});

app.get('/diag', (_req, res) => {
  const links: string[] = [];
  if (existsSync(fallbackHtmlPath)) {
    links.push('<li><a href="/widget/kidbot-fallback.html">Open fallback widget</a></li>');
  }
  if (existsSync(path.join(publicDir, 'diagnostic.html'))) {
    links.push('<li><a href="/public/diagnostic.html">Open diagnostic harness</a></li>');
  }
  links.push('<li><a href="/healthz">Health JSON</a></li>');

  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"/><title>KidBot Diagnostics</title><style>body{font-family:system-ui;margin:32px;color:#111;} a{color:#0066cc;} .tag{display:inline-block;padding:4px 8px;border-radius:999px;background:#eef;border:1px solid #ccd;margin-left:8px;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;}</style></head><body><h1>KidBot Diagnostics <span class="tag">${widgetMode}</span></h1><p>Server port: ${Number(process.env.MCP_PORT ?? 3000)}</p><ul>${links.join('')}</ul><p>Fixtures served from: ${existsSync(fixturesDir) ? '/fixtures' : 'not available'}</p></body></html>`);
});

app.post('/mcp', async (req, res) => {
  try {
    const response = await mcpServer.handleRequest(req.body);
    res.json(response);
  } catch (error) {
    res.status(500).json({ error: 'MCP Error', message: error instanceof Error ? error.message : String(error) });
  }
});

const port = Number(process.env.MCP_PORT ?? 3000);

app.listen(port, () => {
  console.log(`KidBot MCP server listening on http://localhost:${port}`);
});
