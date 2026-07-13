import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { readFileSync, readdirSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { asyncRoute } from './async-route.js';
import { mcpConfig } from './config.js';
import { parentProfileStore, registerTools, requestControlStore } from './tools.js';
import type { Mode } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const widgetResourceUri = 'ui://widget/kidbot.html';

const distDir = path.resolve(__dirname, '../../web-widget/dist');
const assetsDir = path.join(distDir, 'assets');
const fallbackHtmlPath = path.join(distDir, 'kidbot-fallback.html');
const fallbackCssPath = path.join(distDir, 'kidbot-fallback.css');
const fallbackJsPath = path.join(distDir, 'kidbot-fallback.js');

const hasBundle = existsSync(distDir) && existsSync(assetsDir) && readdirSync(assetsDir).some((file) => file.endsWith('.js'));
const fallbackRequested = mcpConfig.fallbackMode;
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

  return `<!doctype html><html><head><meta charset="utf-8"/><title>Kidbot Widget</title><style>${cssContent}</style></head><body><div id="kidbot-root"></div><script type="module">${jsContent}</script></body></html>`;
};

const widgetMode: Mode = fallbackRequested || !hasBundle ? 'fallback' : 'dist';
const widgetHtml = widgetMode === 'fallback' ? resolveFallbackHtml() : resolveDistHtml();

const createMcpServer = (networkIdentity: string): McpServer => {
  const server = new McpServer({ name: 'Kidbot-mcp', version: '0.1.0' });
  registerTools(server, { networkIdentity });

  server.registerResource(
    'kidbot_widget',
    widgetResourceUri,
    {
      title: 'Kidbot Widget',
      description: 'Kidbot interactive widget shell',
      mimeType: 'text/html+skybridge',
      _meta: {
        'openai/widgetDescription': 'Kidbot — safe creative play: voice, comics, coloring, science.',
        'openai/widgetCSP': { connect_domains: [], resource_domains: [] },
        mode: widgetMode
      }
    },
    async () => ({
      contents: [
        {
          uri: widgetResourceUri,
          mimeType: 'text/html+skybridge',
          text: widgetHtml,
          _meta: {
            'openai/widgetDescription': 'Kidbot — safe creative play: voice, comics, coloring, science.',
            'openai/widgetCSP': { connect_domains: [], resource_domains: [] },
            mode: widgetMode
          }
        }
      ]
    })
  );

  return server;
};

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

app.get('/healthz', asyncRoute(async (_req, res) => {
  const parentStore = await parentProfileStore.readiness();
  const requestControls = await requestControlStore.readiness();
  const ok = parentStore.ready && requestControls.ready;
  res.status(ok ? 200 : 503).json({
    ok,
    mode: widgetMode,
    parentProfileStore: parentStore,
    requestControlStore: requestControls,
    time: new Date().toISOString()
  });
}));

app.get('/diag', (_req, res) => {
  const links: string[] = [];
  if (existsSync(fallbackHtmlPath)) {
    links.push('<li><a href="/widget/kidbot-fallback.html">Open fallback widget</a></li>');
  }
  if (existsSync(path.join(publicDir, 'diagnostic.html'))) {
    links.push('<li><a href="/public/diagnostic.html">Open diagnostic harness</a></li>');
  }
  links.push('<li><a href="/healthz">Health JSON</a></li>');

  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"/><title>Kidbot Diagnostics</title><style>body{font-family:system-ui;margin:32px;color:#111;} a{color:#0066cc;} .tag{display:inline-block;padding:4px 8px;border-radius:999px;background:#eef;border:1px solid #ccd;margin-left:8px;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;}</style></head><body><h1>Kidbot Diagnostics <span class="tag">${widgetMode}</span></h1><p>Server port: ${mcpConfig.mcpPort}</p><ul>${links.join('')}</ul><p>Fixtures served from: ${existsSync(fixturesDir) ? '/fixtures' : 'not available'}</p></body></html>`);
});

app.post('/mcp', asyncRoute(async (req, res) => {
  const mcpServer = createMcpServer(req.socket.remoteAddress ?? 'unknown');
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined
  });

  try {
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);

    res.on('close', () => {
      void transport.close();
      void mcpServer.close();
    });
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error'
        },
        id: null
      });
    }
    void transport.close();
    void mcpServer.close();
  }
}));

const port = mcpConfig.mcpPort;

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Kidbot MCP server listening on http://localhost:${port}`);
});
