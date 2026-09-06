/**
 * Development-only host bridge.
 *
 * Inside ChatGPT the host injects `window.openai`. Outside it (plain
 * `pnpm run dev` at localhost:5173) nothing does, so every tool call used to
 * fail with "Widget bridge unavailable". This shim installs a minimal
 * `window.openai` that forwards `callTool` to a local MCP server over its
 * stateless Streamable HTTP endpoint and keeps widget state in memory.
 *
 * It is a no-op when a real host is present, in tests, and in production
 * builds (guarded by `import.meta.env.MODE === 'development'`).
 */
interface JsonRpcResponse {
  result?: unknown;
  error?: { message?: string };
}

const parseRpcBody = (contentType: string, text: string): JsonRpcResponse => {
  if (contentType.includes('text/event-stream')) {
    const dataLines = text.split('\n').filter((line) => line.startsWith('data:'));
    const last = dataLines[dataLines.length - 1];
    if (!last) throw new Error('Empty MCP event stream response.');
    return JSON.parse(last.slice(5)) as JsonRpcResponse;
  }
  return JSON.parse(text) as JsonRpcResponse;
};

export const installDevBridge = (mcpUrl: string): boolean => {
  if (typeof window === 'undefined' || window.openai) {
    return false;
  }

  let nextId = 0;
  let widgetState: Record<string, unknown> | undefined;

  const rpc = async (method: string, params: unknown): Promise<unknown> => {
    const response = await fetch(mcpUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++nextId, method, params }),
    });
    const body = parseRpcBody(response.headers.get('content-type') ?? '', await response.text());
    if (body.error) {
      throw new Error(body.error.message ?? 'MCP request failed.');
    }
    return body.result;
  };

  window.openai = {
    callTool: (name, input) => rpc('tools/call', { name, arguments: input }),
    setWidgetState: (state) => {
      widgetState = state;
      if (window.openai) window.openai.widgetState = state;
    },
    widgetState,
    requestDisplayMode: () => undefined,
  };
  // eslint-disable-next-line no-console
  console.info(`[kidbot] dev bridge installed: tool calls go to ${mcpUrl}`);
  return true;
};

if (import.meta.env.MODE === 'development') {
  installDevBridge(import.meta.env.VITE_MCP_URL ?? 'http://localhost:3000/mcp');
}
