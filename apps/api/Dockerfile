# syntax=docker/dockerfile:1
#
# Shared image for both the `api` (HTTP) and `worker` (background) services —
# same codebase, different entrypoint file, selected via the `command:` in
# docker-compose.yml. See docs/ADR-001-modular-monolith.md.

FROM node:22-alpine AS base
WORKDIR /repo

# ---- deps: install the full workspace dependency graph ----
FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

# ---- build: compile TypeScript ----
# (No `prisma generate` yet: the schema has zero models until Milestone 1,
# and Prisma's CLI refuses to generate a client until at least one exists.)
FROM deps AS build
COPY . .
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
