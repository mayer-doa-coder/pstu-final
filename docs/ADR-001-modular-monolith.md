# ADR-001: Modular Monolith Architecture

## Status

Accepted.

## Context

The system moves simulated money between user wallets and must guarantee
atomicity, retry-safety, and concurrency-safety for every transfer (PRD.md
§1.3, §3.9). It must also remain explainable, testable, and maintainable
while carrying a credible design path toward 10M+ users (PRD.md §1.1.5,
§7.6).

Two broad architectural options were available: a modular monolith on a
single relational database, or a microservices decomposition (e.g. separate
services per domain, communicating over a network).

## Decision

Build a **domain-oriented modular monolith**: one NestJS application (with a
shared worker entrypoint for background processing) backed by a single
PostgreSQL database, organized into clearly bounded internal modules —
`auth`, `users`, `wallets`, `transfers`, `ledger`, `money-requests`,
`idempotency`, `activity`, `notifications`, `outbox`, `audit`, `common`.

The `transfers` module is the only module permitted to perform wallet
debit/credit and ledger writes; `money-requests` calls into it rather than
reimplementing money movement (IMPLEMENTATION_GUIDE.md §1.3).

No microservices, Saga orchestration, CQRS, or Event Sourcing are introduced
at this stage.

## Rationale

1. **Transactional consistency is the hardest requirement.** A transfer must
   debit one wallet, credit another, write balanced ledger entries, and mark
   itself succeeded — atomically (PRD.md §3.3, §3.9). A single PostgreSQL
   transaction with row-level locking (`SELECT ... FOR UPDATE`, deterministic
   lock ordering) makes this straightforward and provable with integration
   tests. A microservices split would force this atomicity across a network
   boundary, requiring a distributed transaction pattern (e.g. Saga) that
   trades a solved problem for a much harder one, with no corresponding
   benefit at this system's scale.
2. **Simplicity is explainable and defensible.** IMPLEMENTATION_GUIDE.md §0
   and §6 (Risk 12) identify premature microservices as a risk: architecture
   optimized for perceived sophistication rather than the actual domain
   need. A modular monolith with enforced internal module boundaries gets
   the organizational benefit (clear ownership, replaceable domains) without
   the operational cost (network calls, partial failure handling,
   service-to-service auth) that isn't yet justified by team size or scale.
3. **It still scales horizontally.** The API is stateless (JWT access
   tokens, no in-process session state); multiple API replicas can run
   behind a load balancer against the same PostgreSQL primary, satisfying
   the 10M+-user design intent (IMPLEMENTATION_GUIDE.md §6, Risk 13) without
   needing service decomposition.
4. **Domain modules remain extractable later.** Because module boundaries
   are enforced now (one module owns balance mutation, others call into it
   rather than duplicating logic), any future extraction into a separate
   service — if scale or team size ever demands it — starts from a
   well-factored codebase instead of a tangled one.
5. **CQRS/Event Sourcing are not justified.** The domain has a small number
   of well-understood state machines (`Transfer`, `MoneyRequest`) with
   synchronous consistency requirements. Event Sourcing would replace a
   simple, auditable relational model (append-only ledger + status columns)
   with a more complex one for no correctness benefit this system needs.

## Consequences

- All financial writes happen inside explicit PostgreSQL transactions in the
  API/worker process — no network hop can partially complete a transfer.
- Redis and the background worker are explicitly non-authoritative: the
  system remains financially correct if either is unavailable
  (IMPLEMENTATION_GUIDE.md §1.1, Risk 8, Risk 9).
- `api` and `worker` deploy as two processes from the _same_ codebase/image
  (different entrypoints — `src/main.ts` vs `src/worker.ts`), not as
  separate services with independent deployment lifecycles.
- If a specific domain module later needs independent scaling or a
  different technology, its already-enforced boundary makes extraction a
  bounded refactor rather than a rewrite.
