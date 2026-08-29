# syntax=docker/dockerfile:1
#
# Shared image for both the `api` (HTTP) and `worker` (background) services —
# same codebase, different entrypoint file, selected via the `command:` in
# docker-compose.yml. See docs/ADR-001-modular-monolith.md.

# Debian (slim), not Alpine: node:22-alpine ships OpenSSL 3.5, which Prisma
# 5.x fails to detect — it then picks an openssl-1.1.x engine that can't load
# (`libssl.so.1.1: not found`) when the migrate container / API starts.
# Debian bookworm's OpenSSL 3.0.x is detected reliably.
FROM node:22-slim AS base
WORKDIR /repo
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# ---- deps: install the full workspace dependency graph ----
FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

# ---- build: compile TypeScript ----
FROM deps AS build
COPY . .
# Generate the real Prisma client (the `npm ci` above only produced a stub —
# the schema isn't in the deps layer) so `nest build` can typecheck against
# `@prisma/client`'s model types.
RUN npm run db:generate
RUN npm run build --workspace apps/api

# ---- runtime: only what's needed to run the compiled API/worker ----
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build /repo/database ./database

WORKDIR /repo/apps/api
EXPOSE 4000

# Overridden by docker-compose.yml's `command:` for the worker service.
CMD ["node", "dist/main.js"]
