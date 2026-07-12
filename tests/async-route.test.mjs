import assert from 'node:assert/strict';
import { IncomingMessage, ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { Socket } from 'node:net';
import test from 'node:test';

import { asyncRoute } from '../apps/mcp-server/src/async-route.ts';

const requireFromMcpServer = createRequire(
  new URL('../apps/mcp-server/package.json', import.meta.url),
);
const express = requireFromMcpServer('express');

const dispatch = async (app, { method = 'GET', path = '/', body } = {}) => {
  const socket = new Socket();
  const request = new IncomingMessage(socket);
  request.method = method;
  request.url = path;
  request.headers = { host: 'localhost' };
  request.body = body;

  const response = new ServerResponse(request);
  const chunks = [];
  response.assignSocket(socket);
  response.write = (chunk) => {
    chunks.push(Buffer.from(chunk));
    return true;
  };

  await new Promise((resolve, reject) => {
    response.end = (chunk) => {
      if (chunk) chunks.push(Buffer.from(chunk));
      response.finished = true;
      resolve();
      return response;
    };
    app.handle(request, response, reject);
  });

  return {
    body: Buffer.concat(chunks).toString('utf8'),
    headers: response.getHeaders(),
    statusCode: response.statusCode,
  };
};

test('forwards a rejected route promise to next exactly once', async () => {
  const failure = new Error('readiness unavailable');
  const forwarded = [];
  const route = asyncRoute(async (...argumentsReceived) => {
    assert.equal(argumentsReceived.length, 2);
    throw failure;
  });

  route({}, {}, (error) => {
    forwarded.push(error);
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(forwarded, [failure]);
});

test('an MCP-style rejection reaches Express error middleware once with a controlled 500', async () => {
  const app = express();
  let errorMiddlewareCalls = 0;

  app.post('/mcp', asyncRoute(async () => {
    throw new Error('transport unavailable');
  }));
  app.use((error, _request, response, _next) => {
    errorMiddlewareCalls += 1;
    response.status(500).json({ error: error.message });
  });

  const response = await dispatch(app, { method: 'POST', path: '/mcp', body: {} });

  assert.equal(errorMiddlewareCalls, 1);
  assert.equal(response.statusCode, 500);
  assert.deepEqual(JSON.parse(response.body), { error: 'transport unavailable' });
});

test('a successful healthz-style response is unchanged', async () => {
  const app = express();

  app.get('/healthz', asyncRoute(async (_request, response) => {
    response.status(200).json({ ok: true, mode: 'dist' });
  }));

  const response = await dispatch(app, { path: '/healthz' });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { ok: true, mode: 'dist' });
});
