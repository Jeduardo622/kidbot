#!/usr/bin/env tsx
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const defaultTheme = 'A robot paints a rainbow garden';
const requireFromWidget = createRequire(new URL('../apps/web-widget/package.json', import.meta.url));
const { JSDOM } = requireFromWidget('jsdom') as typeof import('jsdom');
const React = requireFromWidget('react') as typeof import('react');

type StoryPanel = {
  title?: string;
  caption?: string;
  imagePrompt?: string;
  imageUrl?: string | null;
};

type ToolEvidence = {
  correlationId?: string;
  imageUrls: string[];
  panelCount: number;
};

const trimValue = (value: string | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

export const classifyImageUrl = (url: unknown) => {
  if (typeof url !== 'string' || !url) {
    return 'missing';
  }
  if (url.startsWith('data:image/png;base64,')) {
    return 'data-url';
  }
  if (url.startsWith('/generated-images/')) {
    return 'local-url';
  }
  if (url.includes('/storage/v1/object/public/')) {
    return 'supabase-public-url';
  }
  return 'other-url';
};

export const normalizeMcpBaseUrl = (value: string | undefined) => {
  const raw = trimValue(value);
  if (!raw) {
    throw new Error('KIDBOT_REMOTE_MCP_URL is required for production widget story panels smoke.');
  }
  try {
    const parsed = new URL(raw);
    return `${parsed.origin}${parsed.pathname.replace(/\/mcp\/?$/, '').replace(/\/$/, '')}`;
  } catch {
    throw new Error('MCP base URL must be a valid URL.');
  }
};

const defineGlobalValue = (key: keyof typeof globalThis, value: unknown) => {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value,
    writable: true,
  });
};

export const installDomGlobals = (domWindow: Window) => {
  defineGlobalValue('window', domWindow);
  defineGlobalValue('document', domWindow.document);
  defineGlobalValue('navigator', domWindow.navigator);
  defineGlobalValue('HTMLElement', domWindow.HTMLElement);
  defineGlobalValue('HTMLImageElement', domWindow.HTMLImageElement);
  defineGlobalValue('MutationObserver', domWindow.MutationObserver);
  defineGlobalValue('getComputedStyle', domWindow.getComputedStyle);
};

const parseArgs = (argv: string[]) => {
  const options = {
    mcpBaseUrl: process.env.KIDBOT_REMOTE_MCP_URL,
    panels: 2,
    theme: defaultTheme,
    timeoutMs: 180000,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--mcp-url') {
      options.mcpBaseUrl = argv[++i] ?? options.mcpBaseUrl;
    } else if (arg === '--theme') {
      options.theme = argv[++i] ?? options.theme;
    } else if (arg === '--panels') {
      options.panels = Number(argv[++i] ?? options.panels);
    } else if (arg === '--timeout-ms') {
      options.timeoutMs = Number(argv[++i] ?? options.timeoutMs);
    } else if (arg === '--') {
      continue;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(options.panels) || options.panels < 2 || options.panels > 8) {
    throw new Error('--panels must be an integer from 2 through 8.');
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1000) {
    throw new Error('--timeout-ms must be an integer of at least 1000.');
  }

  return {
    ...options,
    mcpBaseUrl: normalizeMcpBaseUrl(options.mcpBaseUrl),
  };
};

const fetchWithTimeout = async (url: string, options: RequestInit = {}, timeoutMs = 30000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
};

const parseMcpResponse = (text: string) => {
  const dataLines = text.split(/\r?\n/).filter((line) => line.startsWith('data:'));
  if (!dataLines.length) {
    throw new Error(`Missing MCP SSE data line: ${text.slice(0, 300)}`);
  }
  return JSON.parse(dataLines.map((line) => line.slice(5).trimStart()).join('\n'));
};

const callProductionTool = async ({
  mcpBaseUrl,
  name,
  input,
  timeoutMs,
}: {
  input: Record<string, unknown>;
  mcpBaseUrl: string;
  name: string;
  timeoutMs: number;
}) => {
  const response = await fetchWithTimeout(
    `${mcpBaseUrl}/mcp`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 401,
        method: 'tools/call',
        params: {
          name,
          arguments: input,
        },
      }),
    },
    timeoutMs,
  );

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`MCP ${name} HTTP request failed; status=${response.status}; body=${text.slice(0, 200)}`);
  }

  const message = parseMcpResponse(text);
  if (message?.error) {
    throw new Error(`${name} returned MCP error: ${message.error.message ?? 'missing message'}`);
  }
  const result = message?.result ?? {};
  const structured = result.structuredContent ?? {};
  if (result.isError === true) {
    throw new Error(
      `${name} returned MCP tool error; error=${structured.error ?? 'missing'}; fallbackReason=${
        structured.fallbackReason ?? 'missing'
      }; correlationId=${structured.correlationId ?? 'missing'}`,
    );
  }
  return structured;
};

const assertImageFetches = async (imageUrls: string[], timeoutMs: number) => {
  const fetches = [];
  for (const imageUrl of imageUrls) {
    const response = await fetchWithTimeout(imageUrl, { method: 'GET' }, timeoutMs);
    const contentType = response.headers.get('content-type') ?? '';
    const bytes = (await response.arrayBuffer()).byteLength;
    if (!response.ok || contentType !== 'image/png' || bytes <= 0) {
      throw new Error(
        `rendered image fetch failed; status=${response.status}; contentType=${contentType || 'missing'}; bytes=${bytes}`,
      );
    }
    fetches.push({ status: response.status, contentType, bytes });
  }
  return fetches;
};

export const runProductionWidgetStoryPanelsSmoke = async ({
  mcpBaseUrl = process.env.KIDBOT_REMOTE_MCP_URL,
  panels = 2,
  theme = defaultTheme,
  timeoutMs = 180000,
} = {}) => {
  const normalizedMcpBaseUrl = normalizeMcpBaseUrl(mcpBaseUrl);
  const toolEvidence: ToolEvidence = {
    imageUrls: [],
    panelCount: 0,
  };

  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    pretendToBeVisual: true,
    url: 'https://kidbot-widget-smoke.local/',
  });

  installDomGlobals(dom.window);
  Object.assign(globalThis, { React });
  Object.assign(dom.window, { React });

  dom.window.openai = {
    callTool: async (name: string, input: unknown) => {
      const structured = await callProductionTool({
        input: input as Record<string, unknown>,
        mcpBaseUrl: normalizedMcpBaseUrl,
        name,
        timeoutMs,
      });
      if (name === 'story_panels') {
        const panelList = Array.isArray(structured.panels) ? (structured.panels as StoryPanel[]) : [];
        toolEvidence.correlationId =
          typeof structured.correlationId === 'string' ? structured.correlationId : undefined;
        toolEvidence.panelCount = panelList.length;
        toolEvidence.imageUrls = panelList.map((panel) => panel.imageUrl).filter((url): url is string => Boolean(url));
      }
      return structured;
    },
    setWidgetState: () => undefined,
  };

  const { cleanup, fireEvent, render, screen, waitFor, within } = requireFromWidget(
    '@testing-library/react',
  ) as typeof import('@testing-library/react');
  const { ComicBoard } = await import('../apps/web-widget/src/components/ComicBoard.js');

  try {
    render(
      React.createElement(ComicBoard, {
        sessionContext: {
          ageBand: '7-9',
          profileId: 'local-default',
          sessionId: `kb_session_widget_smoke_${Date.now().toString(36)}`,
        },
      }),
      { container: dom.window.document.getElementById('root') as HTMLElement },
    );

    fireEvent.change(screen.getByLabelText('Theme'), { target: { value: theme } });
    fireEvent.change(screen.getByLabelText('Panels'), { target: { value: String(panels) } });
    fireEvent.click(screen.getByRole('button', { name: 'Plan Panels' }));

    await waitFor(
      () => {
        const cards = dom.window.document.querySelectorAll('article.panel-card');
        if (cards.length !== panels) {
          throw new Error(`Rendered ${cards.length} story panel cards; expected ${panels}.`);
        }
        const images = Array.from(dom.window.document.querySelectorAll('article.panel-card img.panel-artwork'));
        if (images.length !== panels) {
          throw new Error(`Rendered ${images.length} panel artwork images; expected ${panels}.`);
        }
      },
      { timeout: timeoutMs },
    );

    const renderedCards = Array.from(dom.window.document.querySelectorAll('article.panel-card'));
    const renderedImages = renderedCards.map((card) => within(card as HTMLElement).getByRole('img'));
    const renderedImageUrls = renderedImages.map((image) => (image as HTMLImageElement).src);
    const renderedImageUrlShapes = renderedImageUrls.map(classifyImageUrl);
    if (renderedImageUrlShapes.some((shape) => shape !== 'supabase-public-url')) {
      throw new Error(`Rendered unexpected image URL shapes: ${renderedImageUrlShapes.join(',') || 'none'}.`);
    }

    const imageFetches = await assertImageFetches(renderedImageUrls, 45000);

    return {
      ok: true,
      mcpBaseUrl: normalizedMcpBaseUrl,
      storyPanels: {
        correlationId: toolEvidence.correlationId ?? null,
        imageUrlCount: toolEvidence.imageUrls.length,
        panelCount: toolEvidence.panelCount,
      },
      widget: {
        component: 'ComicBoard',
        renderedImageCount: renderedImages.length,
        renderedImageUrlShapes,
        renderedPanelCount: renderedCards.length,
      },
      renderedImages: imageFetches,
    };
  } finally {
    cleanup();
    dom.window.close();
  }
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const result = await runProductionWidgetStoryPanelsSmoke(options);
  console.log(JSON.stringify(result, null, 2));
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(
      JSON.stringify(
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
    );
    process.exit(1);
  });
}
