# syntax=docker/dockerfile:1.7
# One Dockerfile, three targets: api (also runs the worker), web (nginx + SPA), mcp.

FROM node:22-alpine AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/mcp-server/package.json packages/mcp-server/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
COPY . .
RUN pnpm -r run build \
 && pnpm --filter @leadpilot/api deploy --prod --legacy /out/api \
 && pnpm --filter @leadpilot/mcp-server deploy --prod --legacy /out/mcp

FROM node:22-alpine AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/api ./
USER node
EXPOSE 3000 9465
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://127.0.0.1:${PORT:-3000}/healthz >/dev/null || exit 1
CMD ["node", "--import", "./dist/tracing.js", "dist/main.js"]

FROM node:22-alpine AS mcp
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/mcp ./
USER node
ENTRYPOINT ["node", "dist/index.js"]

FROM nginx:1.27-alpine AS web
ENV API_UPSTREAM=http://api:3000
COPY deploy/docker/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
