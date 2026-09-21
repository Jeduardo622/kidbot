import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const requireFromWidget = createRequire(new URL('../apps/web-widget/package.json', import.meta.url));
const { JSDOM } = requireFromWidget('jsdom');

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test('fallback is a disclosed offline demo that never fetches or calls Kidbot tools', async () => {
  const [htmlSource, script, sourceHtml, sourceScript] = await Promise.all([
    readFile('apps/web-widget/dist/kidbot-fallback.html', 'utf8'),
    readFile('apps/web-widget/dist/kidbot-fallback.js', 'utf8'),
    readFile('apps/web-widget/public/kidbot-fallback.html', 'utf8'),
    readFile('apps/web-widget/public/kidbot-fallback.js', 'utf8'),
  ]);
  assert.equal(htmlSource, sourceHtml, 'Vite output must contain the tracked offline source');
  assert.equal(script, sourceScript, 'Vite output must contain the tracked offline source');
  const html = htmlSource.replace('<script src="./kidbot-fallback.js"></script>', '');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://offline.example/' });
  const { window } = dom;
  let fetchCalls = 0;
  let toolCalls = 0;
  window.fetch = async () => {
    fetchCalls += 1;
    return new Response('{}', { status: 503 });
  };
  window.openai = {
    callTool: async () => {
      toolCalls += 1;
      return {};
    },
  };
  window.HTMLCanvasElement.prototype.getContext = () => ({
    beginPath() {},
    clearRect() {},
    lineTo() {},
    moveTo() {},
    stroke() {},
  });
  window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,offline';
  window.HTMLAnchorElement.prototype.click = () => {};

  window.eval(script);
  for (const id of ['kb-voice-send', 'kb-comic-generate', 'kb-color-generate', 'kb-sci-generate']) {
    window.document.getElementById(id)?.click();
  }
  await settle();

  assert.match(window.document.querySelector('[role="status"]')?.textContent ?? '', /offline demo/i);
  assert.match(window.document.body.textContent ?? '', /fixed sample content/i);
  assert.equal(fetchCalls, 0);
  assert.equal(toolCalls, 0);
  assert.match(window.document.getElementById('kb-voice-out')?.textContent ?? '', /Moon/i);
  assert.equal(window.document.querySelectorAll('#kb-comic-grid .kb-card').length, 4);
  assert.match(window.document.getElementById('kb-color-svg')?.innerHTML ?? '', /<svg/i);
  assert.match(window.document.getElementById('kb-sci-out')?.textContent ?? '', /Float or Sink/i);

  dom.window.close();
});
