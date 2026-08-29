# AGENT.md — Money Movement Application

Instructions for any AI coding assistant or autonomous agent working in this repository. Grounded in [PRD.md](PRD.md) and [IMPLEMENTATION_GUIDE.md](IMPLEMENTATION_GUIDE.md). If this file conflicts with those documents, the documents win — update this file to match, don't silently diverge.

---

## 1. Project Overview

**What:** A closed-loop digital money movement platform. Registered users hold simulated **BDT** balances and can **send money**, **request money**, **accept/decline requests**, and view **balance & transaction history**.

**Core mission:** Make money movement simple for users while making state transitions **strict, traceable, retry-safe, and concurrency-safe** for engineers.

**Not a CRUD app.** This is a state-transition and consistency problem. Every feature decision should be evaluated against correctness first, then scalability/operability, then convenience.

**Non-negotiable product principles** (PRD §1.3):

1. Correctness before convenience
2. Every transfer is atomic
3. Every write is auditable
4. Retries are safe
5. No hidden balance mutations
6. The UI never claims success before the backend confirms it
7. Failure states are explicit
8. Critical domain rules live in the backend, not the client
9. Architecture must be easy to explain, test, extend, operate
10. Complexity must earn its place

**Explicitly out of scope:** real banks/cards/payment gateways, real-money settlement, KYC/AML, cross-currency exchange, loans, interest, investment, crypto, offline transfers. Do not build toward these.

---

## 2. Tech Stack & Tools

| Layer                                | Choice                                                                                               |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Frontend                             | Next.js + TypeScript                                                                                 |
| Backend                              | NestJS + TypeScript                                                                                  |
| Database                             | PostgreSQL (source of truth for all financial data)                                                  |
| ORM / query layer                    | Prisma, Drizzle, or TypeORM; **raw SQL is acceptable and often preferable for wallet-locking paths** |
| Cache / rate limit / transient state | Redis (never authoritative)                                                                          |
| Background jobs                      | BullMQ or equivalent                                                                                 |
| Auth                                 | Secure cookie session, or JWT access + refresh token model                                           |
| Validation                           | Zod or class-validator                                                                               |
| Observability                        | OpenTelemetry-compatible logs/metrics/traces                                                         |
| Local dev                            | Docker Compose (Postgres + Redis)                                                                    |
| Load/concurrency testing             | k6, Artillery, Gatling, or Locust                                                                    |

The stack is language-agnostic in principle, but if it changes, **every domain guarantee below must still hold**.

---

## 3. Architecture & Directory Structure

**Pattern: modular monolith**, not microservices. One deployable API app, clear internal module boundaries, PostgreSQL transactions for atomicity. Extract services later only when operational evidence demands it (see Risk 12 in the Implementation Guide).

### Domain modules (`apps/api/src/`)

```
auth/            money-requests/    outbox/
users/           ledger/            audit/
wallets/         idempotency/       common/
transfers/       activity/          notifications/
```

**Hard rule:** the `transfers` module is the **only** module allowed to orchestrate balance movement (debit/credit). The `money-requests` module calls the transfer domain service on accept — it must never reimplement debit/credit logic itself.

### Repository layout

```
money-movement/
├── apps/
│   ├── web/                 # Next.js frontend
│   └── api/                 # NestJS backend
├── packages/
│   ├── shared-types/
│   ├── validation/
│   ├── config/
│   └── observability/
├── database/
│   ├── migrations/
│   ├── seeds/
│   └── scripts/
├── docs/                     # PRD, this guide, ADRs, API.md, RUNBOOK.md
├── tests/
│   ├── integration/
│   ├── e2e/
│   ├── concurrency/
│   └── load/
├── docker-compose.yml
└── README.md
```

New files go in the module they logically belong to. Don't create new top-level modules without a clear domain reason.

---

## 4. Data Model (Normative)

Money is always `BIGINT` integer minor units (poisha). Never use float/decimal for currency. Currency is fixed `BDT` for MVP.

Core tables (see Implementation Guide §2 for full DDL): `users`, `wallets`, `transfers`, `ledger_entries`, `money_requests`, `idempotency_records`, `outbox_events`, `notifications`, `audit_events`.

Key invariants enforced at the DB level, not just app level:

- `wallets.balance_minor >= 0` (CHECK constraint — last-line guard, not primary defense)
- `transfers.sender_user_id <> receiver_user_id`
- `transfers.amount_minor > 0`
- `idempotency_records` unique on `(actor_user_id, route_key, idempotency_key)`
- Ledger entries are **append-only** — never edited or deleted
- Every successful transfer has balanced ledger entries: `SUM(signed_amount_minor) = 0`

Never delete or backfill-edit ledger rows. Never add a generic "update wallet balance" endpoint — all balance mutation flows through the transfer domain service.

---

## 5. Coding Standards & Rules

### Do

- Store all money as integer minor units (`BIGINT`), everywhere — DB, API payloads, domain logic.
- Wrap every balance-affecting operation in a single DB transaction. Debit, credit, ledger writes, and status update commit together or not at all.
- Lock wallet rows with `SELECT ... FOR UPDATE`, always in **deterministic order by wallet ID** (lower ID first) to avoid deadlocks.
- Revalidate account/wallet status and balance sufficiency **inside** the lock, not just before it.
- Require an `Idempotency-Key` header on every state-changing money endpoint (create transfer, create request, accept, decline, cancel). Persist idempotency state durably in PostgreSQL — never only in Redis.
- Use cursor-based pagination for all list endpoints (activity, requests, search). No unbounded lists, no `OFFSET` at scale.
- Use the outbox pattern for anything non-critical (notifications, analytics) — insert the event in the same DB transaction as the financial write, process it asynchronously.
- Return the standard response/error envelope (§API Conventions) on every endpoint.
- Write integration tests against a real PostgreSQL container for anything involving locking, transactions, or idempotency — unit tests alone are not sufficient proof.
- Use opaque UUIDs (UUIDv7 preferred) for all primary keys.

### Don't

- Don't perform balance math or authorization decisions on the client. The backend is authoritative; client-side validation is UX sugar only.
- Don't call external/remote services (notifications, analytics, email) from inside a money-movement DB transaction. Use the outbox.
- Don't implement idempotency in Redis alone — it must be durable.
- Don't add administrative "fix the balance" endpoints. Corrections, if ever needed, are new compensating transfers, never edits to history.
- Don't expose another user's wallet balance via search or any non-owner endpoint.
- Don't log passwords, tokens, secrets, or full private note contents.
- Don't let notification/analytics/Redis failures affect whether a transfer commits or appears to succeed.
- Don't introduce microservices, message queues between services, or premature distributed-systems complexity — the modular monolith is a deliberate choice, not a placeholder.
- Don't reach for `OFFSET` pagination on any table that can grow to millions of rows.

---

## 6. Workflow & Testing

### Local dev

Bring up Postgres + Redis via `docker-compose.yml`; run frontend and backend from `apps/web` and `apps/api` respectively. Environment must be validated at boot (fail fast on missing config). A health endpoint must exist and pass before considering the app "up."

### CI pipeline (minimum)

lint → typecheck → unit tests → integration tests (real Postgres) → migration validation.

### Test pyramid

- **Unit:** validation, state machine rules, money formatting, request-hash generation, authorization helpers.
- **Integration (real Postgres):** row locking, transactions, idempotency, ledger consistency, unique constraints, state transitions.
- **API:** endpoint contracts, auth, error codes, pagination, permission boundaries.
- **E2E:** register → send → receipt; request → accept → both balances updated; duplicate-submit behavior.
- **Load/concurrency:** stress-test concurrent transfers from the same wallet; verify no negative balances, no duplicate effects.

### Mandatory correctness proofs before calling transfer/request work "done"

These map to PRD §8.4 and Implementation Guide §5.2 — treat them as acceptance gates, not nice-to-haves:

1. A transfer never partially completes (inject failure mid-transaction, assert no partial state).
2. Same idempotency key replayed N times → exactly one financial effect, all responses match the original.
3. Two concurrent transfers that together exceed balance → exactly one succeeds, one gets `INSUFFICIENT_BALANCE`, no negative balance.
4. A money request can be accepted at most once, even under 20 concurrent accept calls.
5. Unauthorized users get `403`/`404` on transactions they don't participate in, with no state mutation.
6. Every successful transfer's ledger entries sum to zero.
7. Notification/analytics/worker outage never blocks or rolls back a committed transfer.

### Milestone order

The Implementation Guide defines an 11-step milestone sequence (Repository Foundation → Auth/Wallet → Discovery → Transfer Core → Request Money → Activity → Outbox/Notifications → Observability → Security → Load/Chaos testing → Production Readiness). Follow this order — later milestones assume earlier invariants (locking, idempotency, ledger) are already correct and tested. Don't build UI polish or notifications ahead of transfer correctness.

### Before marking any transfer/request feature complete

Run the relevant concurrency and idempotency tests, not just the happy path. If you can't run a real Postgres instance in your environment, say so explicitly rather than claiming the invariants are proven.
