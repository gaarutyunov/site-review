# syntax=docker/dockerfile:1

# Site Review MCP + ingest server. Multi-stage: build the pnpm workspace, then
# ship a slim, self-contained deploy of just the server package.
#
# Build context is the repo ROOT (so the workspace + lockfile are visible):
#   docker build -f packages/server/Dockerfile -t ghcr.io/gaarutyunov/site-review .

# ---- builder -------------------------------------------------------------- #
FROM node:22-bookworm AS builder
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

# better-sqlite3 compiles a native addon; build tools come with the full image.
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @site-review/shared build \
 && pnpm --filter @site-review/server build

# Flatten the server package + its production deps into a portable folder.
# --legacy: pnpm 10 otherwise refuses to deploy non-injected workspace packages.
RUN pnpm --filter @site-review/server deploy --legacy --prod /out

# ---- runtime -------------------------------------------------------------- #
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    SITE_REVIEW_PORT=4711 \
    SITE_REVIEW_DB=/data/comments.db
WORKDIR /app

COPY --from=builder /out ./

# Persist the SQLite database in a volume; make it writable by the node user.
RUN mkdir -p /data && chown -R node:node /data
VOLUME /data
USER node

EXPOSE 4711
CMD ["node", "dist/index.js"]
