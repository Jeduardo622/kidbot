FROM node:20-bookworm-slim AS production

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@8.15.8 --activate

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY apps/mcp-server/package.json apps/mcp-server/package.json
COPY apps/web-widget/package.json apps/web-widget/package.json
RUN pnpm install --frozen-lockfile --filter @kidbot/mcp-server... --filter @kidbot/web-widget...

COPY apps/mcp-server/tsconfig.json apps/mcp-server/tsconfig.json
COPY apps/mcp-server/src apps/mcp-server/src
COPY apps/mcp-server/public apps/mcp-server/public
COPY apps/web-widget/index.html apps/web-widget/index.html
COPY apps/web-widget/tsconfig.json apps/web-widget/tsconfig.json
COPY apps/web-widget/vite.config.ts apps/web-widget/vite.config.ts
COPY apps/web-widget/public apps/web-widget/public
COPY apps/web-widget/src apps/web-widget/src
RUN pnpm --filter @kidbot/web-widget run build \
 && node --import tsx apps/mcp-server/src/widgetArtifact.ts apps/web-widget/dist \
 && pnpm --filter @kidbot/mcp-server run build

ENV NODE_ENV=production
USER node
CMD ["node", "--enable-source-maps", "apps/mcp-server/dist/server.js"]
