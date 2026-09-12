import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

for (const service of ['agent-service', 'mcp-server']) {
  test(`${service} has a bounded production Railway Docker deployment`, async () => {
    const dockerfile = await readFile(`apps/${service}/Dockerfile`, 'utf8');
    const railway = JSON.parse(await readFile(`apps/${service}/railway.json`, 'utf8'));

    assert.equal(railway.build.builder, 'DOCKERFILE');
    assert.equal(railway.build.dockerfilePath, `apps/${service}/Dockerfile`);
    assert.equal(railway.deploy.healthcheckPath, '/healthz');
    assert.match(dockerfile, /ENV NODE_ENV=production/);
    assert.doesNotMatch(dockerfile, /COPY\s+\.\s+\./);
    assert.doesNotMatch(dockerfile, new RegExp(`COPY apps/${service} apps/${service}`));
    assert.doesNotMatch(dockerfile, /\.env/);
  });
}

test('MCP production image builds and verifies the widget before service compilation', async () => {
  const dockerfile = await readFile('apps/mcp-server/Dockerfile', 'utf8');
  const widgetBuild = dockerfile.indexOf('pnpm --filter @kidbot/web-widget run build');
  const artifactCheck = dockerfile.indexOf('apps/mcp-server/src/widgetArtifact.ts');
  const mcpBuild = dockerfile.indexOf('pnpm --filter @kidbot/mcp-server run build');

  assert.ok(widgetBuild > 0, 'missing widget production build');
  assert.ok(artifactCheck > widgetBuild, 'widget artifact check must follow widget build');
  assert.ok(mcpBuild > artifactCheck, 'MCP compile must follow the artifact gate');
  assert.doesNotMatch(dockerfile, /COPY apps\/web-widget apps\/web-widget/);
});
