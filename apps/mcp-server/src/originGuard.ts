import type { RequestHandler } from 'express';

/**
 * Page origins ChatGPT serves the app from. Tool calls themselves arrive from
 * OpenAI's servers and carry no Origin header at all, so this list exists to
 * bound *browser* traffic, not to authenticate the host.
 */
export const chatGptOrigins = Object.freeze([
  'https://chatgpt.com',
  'https://chat.openai.com',
  'https://web-sandbox.oaiusercontent.com',
]);

export const isOriginAllowed = (origin: string, allowlist: readonly string[]): boolean => {
  try {
    return allowlist.includes(new URL(origin).origin);
  } catch {
    return false;
  }
};

/**
 * Browser-origin gate for `/mcp`.
 *
 * A request with no Origin header is a server-to-server MCP client (the
 * ChatGPT backend, the production smokes) and passes through. A request that
 * *does* carry a browser Origin is honoured only when the operator listed it,
 * so a page on an unrelated site cannot drive the tools with a visitor's
 * network identity. Refusal happens before admission control, so a rejected
 * origin never spends a rate-limit lease.
 *
 * `undefined` disables the gate, which is the development default; production
 * always resolves to a list.
 */
export const createOriginGuard = (allowlist: readonly string[] | undefined): RequestHandler =>
  (req, res, next) => {
    if (!allowlist) {
      next();
      return;
    }

    res.vary('Origin');
    const origin = req.headers.origin;
    if (typeof origin !== 'string' || origin.length === 0) {
      next();
      return;
    }

    if (!isOriginAllowed(origin, allowlist)) {
      res.status(403).json({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'origin_not_allowed' },
        id: null,
      });
      return;
    }

    res.setHeader('Access-Control-Allow-Origin', origin);
    next();
  };
