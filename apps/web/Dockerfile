# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
WORKDIR /repo

# ---- deps: install the full workspace dependency graph ----
FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

# ---- build: compile the Next.js app ----
FROM deps AS build
COPY . .
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/api/v1
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
RUN npm run build --workspace apps/web

# ---- runtime: serve the compiled app ----
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/web/.next ./apps/web/.next
COPY --from=build /repo/apps/web/public ./apps/web/public
COPY --from=build /repo/apps/web/package.json ./apps/web/package.json
COPY --from=build /repo/apps/web/next.config.js ./apps/web/next.config.js

WORKDIR /repo/apps/web
EXPOSE 3000
CMD ["/repo/node_modules/.bin/next", "start", "-p", "3000"]
