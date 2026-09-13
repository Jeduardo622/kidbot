import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  inspectWidgetArtifact,
  renderWidgetDocument,
  resolveWidgetMode,
} from '../apps/mcp-server/src/widgetArtifact.ts';

test('rendered MCP widget document preserves mobile viewport and language metadata', () => {
  const document = renderWidgetDocument({ css: '.widget{}', javascript: 'window.widget = true;' });
  assert.match(document, /<html lang="en">/);
  assert.match(document, /<meta name="viewport" content="width=device-width,initial-scale=1"/);
  assert.match(document, /<style>\.widget\{\}<\/style>/);
  assert.match(document, /<script type="module">window\.widget = true;<\/script>/);
});

test('secured production refuses to start without a complete widget distribution', async () => {
  const distDir = await mkdtemp(path.join(tmpdir(), 'kidbot-widget-missing-'));
  try {
    const artifact = inspectWidgetArtifact(distDir);
    assert.equal(artifact.distReady, false);
    assert.throws(
      () => resolveWidgetMode({ artifact, fallbackRequested: false, nodeEnv: 'production' }),
      /production widget distribution is incomplete/i,
    );
  } finally {
    await rm(distDir, { force: true, recursive: true });
  }
});

test('a built widget distribution selects dist mode and exposes artifact readiness', async () => {
  const distDir = await mkdtemp(path.join(tmpdir(), 'kidbot-widget-built-'));
  try {
    await mkdir(path.join(distDir, 'assets'));
    await writeFile(path.join(distDir, 'index.html'), '<script type="module" src="./assets/index-test.js"></script><link rel="stylesheet" href="./assets/index-test.css">');
    await writeFile(path.join(distDir, 'assets', 'index-test.js'), 'console.log("widget")');
    await writeFile(path.join(distDir, 'assets', 'index-test.css'), '.widget { display: block; }');

    const artifact = inspectWidgetArtifact(distDir);
    assert.deepEqual(
      {
        distReady: artifact.distReady,
        indexHtml: artifact.indexHtml,
        javascriptAsset: artifact.javascriptAsset,
        stylesheetAsset: artifact.stylesheetAsset,
      },
      {
        distReady: true,
        indexHtml: 'index.html',
        javascriptAsset: 'assets/index-test.js',
        stylesheetAsset: 'assets/index-test.css',
      },
    );
    assert.equal(
      resolveWidgetMode({ artifact, fallbackRequested: false, nodeEnv: 'production' }),
      'dist',
    );
  } finally {
    await rm(distDir, { force: true, recursive: true });
  }
});

test('production artifact rejects missing, empty, external, and traversing referenced assets', async () => {
  const cases = [
    {
      html: '<script src="./assets/missing.js"></script><link rel="stylesheet" href="./assets/index.css">',
      files: { 'assets/index.css': '.widget{}' },
    },
    {
      html: '<script src="./assets/index.js"></script><link rel="stylesheet" href="./assets/index.css">',
      files: { 'assets/index.js': '', 'assets/index.css': '.widget{}' },
    },
    {
      html: '<script src="https://cdn.example/widget.js"></script><link rel="stylesheet" href="./assets/index.css">',
      files: { 'assets/index.css': '.widget{}' },
    },
    {
      html: '<script src="../outside.js"></script><link rel="stylesheet" href="./assets/index.css">',
      files: { 'assets/index.css': '.widget{}' },
    },
    {
      html: '<script src="./assets/index.js"></script><link rel="stylesheet" href="./assets/missing.css">',
      files: { 'assets/index.js': 'console.log("widget")' },
    },
  ];

  for (const scenario of cases) {
    const distDir = await mkdtemp(path.join(tmpdir(), 'kidbot-widget-invalid-'));
    try {
      await mkdir(path.join(distDir, 'assets'));
      await writeFile(path.join(distDir, 'index.html'), scenario.html);
      for (const [relativePath, content] of Object.entries(scenario.files)) {
        await writeFile(path.join(distDir, relativePath), content);
      }
      assert.equal(inspectWidgetArtifact(distDir).distReady, false);
    } finally {
      await rm(distDir, { force: true, recursive: true });
    }
  }
});

test('an explicit complete offline fallback remains available when dist is invalid', async () => {
  const distDir = await mkdtemp(path.join(tmpdir(), 'kidbot-widget-offline-'));
  try {
    for (const file of ['kidbot-fallback.html', 'kidbot-fallback.css', 'kidbot-fallback.js']) {
      await writeFile(path.join(distDir, file), 'offline sample');
    }
    const artifact = inspectWidgetArtifact(distDir);
    assert.equal(artifact.distReady, false);
    assert.equal(artifact.fallbackReady, true);
    assert.equal(resolveWidgetMode({ artifact, fallbackRequested: true, nodeEnv: 'development' }), 'fallback');
    assert.throws(
      () => resolveWidgetMode({ artifact, fallbackRequested: true, nodeEnv: 'production' }),
      /offline fallback.*not allowed in production/i,
    );
  } finally {
    await rm(distDir, { force: true, recursive: true });
  }
});
