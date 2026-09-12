FROM node:20-bookworm-slim AS production

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@8.15.8 --activate

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY apps/agent-service/package.json apps/agent-service/package.json
RUN pnpm install --frozen-lockfile --filter @kidbot/agent-service...

COPY apps/agent-service/tsconfig.json apps/agent-service/tsconfig.json
COPY apps/agent-service/src apps/agent-service/src
RUN pnpm --filter @kidbot/agent-service run build

ENV NODE_ENV=production
USER node
CMD ["node", "--enable-source-maps", "apps/agent-service/dist/index.js"]
