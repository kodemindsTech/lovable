# Build from the repo root:  docker build -f apps/api/Dockerfile -t fitness-os-api .
FROM node:22-slim AS base
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/ai/package.json packages/ai/
COPY packages/data/package.json packages/data/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @fitness-os/api...
COPY packages/core packages/core
COPY packages/ai packages/ai
COPY packages/data packages/data
COPY apps/api apps/api
ENV NODE_ENV=production
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://localhost:'+(process.env.PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
WORKDIR /repo/apps/api
CMD ["pnpm", "start"]
