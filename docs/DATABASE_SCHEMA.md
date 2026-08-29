# Simplified Database Schema

This document is the simple, logical view of the Money Movement database.
The executable source of truth remains `database/prisma/schema.prisma` and its
migrations.

## Core banking data

```mermaid
erDiagram
    USER ||--|| WALLET : owns
    USER ||--o{ TRANSFER : sends
    USER ||--o{ TRANSFER : receives
    WALLET ||--o{ LEDGER_ENTRY : records
    TRANSFER ||--|{ LEDGER_ENTRY : creates
    USER ||--o{ MONEY_REQUEST : requests
    USER ||--o{ MONEY_REQUEST : pays
    MONEY_REQUEST o|--o| TRANSFER : settled_by

    USER {
        uuid id PK
        string email UK
        string display_name
        string password_hash
        enum status
        enum verification_status
        string nid_hash UK
        string nid_masked
        datetime created_at
    }

    WALLET {
        uuid id PK
        uuid user_id FK,UK
        string currency
        bigint balance_minor
        enum status
        datetime created_at
    }

    TRANSFER {
        uuid id PK
        uuid sender_user_id FK
        uuid receiver_user_id FK
        uuid sender_wallet_id FK
        uuid receiver_wallet_id FK
        bigint amount_minor
        string currency
        enum status
        enum source_type
        uuid source_request_id FK
        string note
        datetime created_at
        datetime completed_at
    }

    LEDGER_ENTRY {
        uuid id PK
        uuid transfer_id FK
        uuid wallet_id FK
        enum direction
        bigint signed_amount_minor
        bigint balance_after_minor
        datetime created_at
    }

    MONEY_REQUEST {
        uuid id PK
        uuid requester_user_id FK
        uuid payer_user_id FK
        bigint amount_minor
        string currency
        enum status
        uuid accepted_transfer_id FK,UK
        string note
        datetime expires_at
        datetime created_at
        datetime resolved_at
    }
```

## Supporting data

```mermaid
erDiagram
    USER ||--o{ AUTH_SESSION : has
    USER ||--o{ IDEMPOTENCY_RECORD : owns
    USER ||--o{ NOTIFICATION : receives
    USER o|--o{ AUDIT_EVENT : performs
    TRANSFER ||--o| RISK_ASSESSMENT : receives
    OUTBOX_EVENT ||--o{ NOTIFICATION : produces

    AUTH_SESSION {
        uuid id PK
        uuid user_id FK
        string refresh_token_hash UK
        datetime expires_at
        datetime revoked_at
    }

    IDEMPOTENCY_RECORD {
        uuid id PK
        uuid actor_user_id FK
        string route_key
        string idempotency_key
        string request_hash
        enum state
        json response_body
        datetime expires_at
    }

    OUTBOX_EVENT {
        uuid id PK
        string event_type
        uuid aggregate_id
        json payload
        datetime occurred_at
        datetime processed_at
        int attempt_count
        datetime next_attempt_at
    }

    NOTIFICATION {
        uuid id PK
        uuid user_id FK
        uuid source_event_id UK
        string type
        string title
        string body
        datetime read_at
        datetime created_at
    }

    AUDIT_EVENT {
        uuid id PK
        uuid actor_user_id FK
        string action
        string resource_type
        uuid resource_id
        string request_id
        json metadata
        datetime created_at
    }

    RISK_ASSESSMENT {
        uuid id PK
        uuid transfer_id FK,UK
        int score
        enum level
        json reasons
        string explanation
        datetime created_at
    }
```

## What each table is for

| Table                 | Purpose                                                                  |
| --------------------- | ------------------------------------------------------------------------ |
| `users`               | Account identity, login details, status and simplified NID verification. |
| `wallets`             | One BDT wallet and current balance for each user.                        |
| `transfers`           | One money movement from a sender to a receiver.                          |
| `ledger_entries`      | Immutable debit and credit records for each completed transfer.          |
| `money_requests`      | Requests that can be accepted, declined, cancelled or expired.           |
| `auth_sessions`       | Hashed refresh tokens and session revocation state.                      |
| `idempotency_records` | Prevents a retried request from moving money twice.                      |
| `outbox_events`       | Reliable events waiting for the background worker.                       |
| `notifications`       | In-app messages created from processed events.                           |
| `audit_events`        | Trace of important security and financial actions.                       |
| `risk_assessments`    | One deterministic risk result for a transfer.                            |

## Important rules

1. Every user has at most one wallet.
2. Money is stored as integer poisha in `BIGINT`, never floating point.
3. The currency is fixed to `BDT` for this project.
4. Wallet balances cannot become negative.
5. A sender and receiver cannot be the same user.
6. Every successful transfer creates one debit and one matching credit.
7. Ledger entries are append-only and must not be edited or deleted.
8. A money request can be settled by at most one transfer.
9. An idempotency key can create only one effect for a route and user.
10. A worker retry cannot create the same notification twice.
11. Raw NID numbers and raw refresh tokens are never stored.

## Deliberately not separate tables

- **Activity:** derived from transfers and money requests.
- **Verification:** stored as a few fields on the user record.
- **Balance history:** represented by immutable ledger entries.
- **Transfer source:** stored on the transfer and linked to a money request when needed.
