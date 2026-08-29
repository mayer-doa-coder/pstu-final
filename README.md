# Money Movement Application

Closed-loop, simulated-BDT money movement platform. See [PRD.md](PRD.md) for
product requirements and [IMPLEMENTATION_GUIDE.md](IMPLEMENTATION_GUIDE.md)
for the technical build plan this repository follows.

**Status: Milestone 0 — engineering foundation.** No product features
(auth, wallets, transfers, requests) are implemented yet.

## Architecture

Domain-oriented **modular monolith** — see
[docs/ADR-001-modular-monolith.md](docs/ADR-001-modular-monolith.md).

- `apps/api` — NestJS backend. One codebase, two entrypoints:
  - `src/main.ts` — HTTP API server
  - `src/worker.ts` — background worker (no HTTP listener)
- `apps/web` — Next.js frontend
- `database/prisma` — Prisma schema and migrations (source of truth for the
  database schema)

## Running with Docker (recommended)

```bash
cp .env.example .env
docker compose up --build
```

This starts, in order: `postgres`, `redis` → `migrate` (applies pending
Prisma migrations, then exits) → `api`, `worker` → `web`.

| Service      | URL                                 |
| ------------ | ----------------------------------- |
| Web          | http://localhost:3000               |
| API          | http://localhost:4000/api/v1        |
| Health check | http://localhost:4000/api/v1/health |

Stop with `docker compose down` (add `-v` to also drop the Postgres volume).

## Running locally without Docker

Requires Node.js 20+, and a local PostgreSQL + Redis (or point `.env` at
remote ones).

```bash
cp .env.example .env
npm install
npm run db:migrate:dev      # applies migrations to the DATABASE_URL in .env

npm run --workspace apps/api start:dev   # API on :4000
npm run --workspace apps/web dev         # Web on :3000
```

> `npm run db:generate` (Prisma client codegen) is not yet usable: the
> schema has zero models until Milestone 1 adds `users`/`wallets`, and
> Prisma's CLI refuses to generate a client with none defined. Database
> access in Milestone 0 uses `pg` directly (see
> `apps/api/src/database/postgres-pool.service.ts`).

## Scripts (run from the repo root)

| Command                                         | Description                                                          |
| ----------------------------------------------- | -------------------------------------------------------------------- |
| `npm run lint`                                  | ESLint across all workspaces                                         |
| `npm run format:check` / `npm run format`       | Prettier check / write                                               |
| `npm run typecheck`                             | `tsc --noEmit` across all workspaces                                 |
| `npm test`                                      | Unit + API tests (Jest) across all workspaces                        |
| `npm run test:integration --workspace apps/api` | Integration tests against a real Postgres container (Testcontainers) |
| `npm run build`                                 | Production build across all workspaces                               |
| `npm run db:migrate:dev`                        | Create/apply a migration during development                          |
| `npm run db:migrate:deploy`                     | Apply pending migrations (CI/production)                             |

## Testing strategy

Jest + Supertest (unit/API) · Testcontainers (integration, against a real
ephemeral PostgreSQL container — run from the host/CI process, never
Docker-in-Docker inside the API image) · Playwright (E2E, added once there
are real screens to test) · k6 (load/concurrency, added in Milestone 9).

## Environment configuration

See [.env.example](.env.example). The API validates its environment at boot
(`apps/api/src/config/env.schema.ts`, Zod) and fails fast if required
variables are missing or malformed.

## Milestones

Full sequence in [IMPLEMENTATION_GUIDE.md](IMPLEMENTATION_GUIDE.md) §4. All
milestones (0–10) are in scope — implementation is not time-boxed
(PRD.md, Document Status).
