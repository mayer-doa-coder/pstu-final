# PRD.md

# Money Movement Application — Product Requirements Document

## Document Status

- **Product:** Closed-loop Money Movement Application
- **Primary surfaces:** Responsive web application; mobile application may be added later using the same backend APIs
- **Money type:** Simulated/fake BDT only
- **Primary capabilities:** Send money, request money, receive/accept requests, account balance, transaction history, trustworthy transaction processing
- **Architecture intent:** Production-ready design with correctness, concurrency safety, retry safety, maintainability, and a credible path to supporting 10M+ users
- **Out of scope:** Real banks, cards, payment gateways, financial networks, real-money settlement, regulatory KYC/AML integrations
- **Build-time assumption:** Although the source rulebook describes a six-hour hackathon, this PRD intentionally does **not** constrain the product design by implementation time, per the current project instruction.

---

# 1. Executive Summary & Problem Statement

## 1.1 What We Are Building

We are building a **trustworthy closed-loop digital money platform** in which registered users hold simulated BDT balances and can move money between one another.

The system must support:

1. **Send Money**
   - User A sends a chosen amount to User B.
   - The sender is debited and the receiver is credited atomically.

2. **Request Money**
   - User A requests a chosen amount from User B.
   - User B can accept or decline the request.
   - Accepting the request performs the same trustworthy money-transfer operation as a direct send.

3. **Balance & Transaction History**
   - Every user has a wallet/account balance.
   - Users can inspect money sent, money received, requests, statuses, and timestamps.

4. **Trustworthy Transaction Processing**
   - Repeated clicks, retries, timeouts, concurrent operations, malformed inputs, and server failures must not create duplicate transfers or inconsistent balances.
   - Every successful transfer must have a durable, auditable record.

5. **Scalable Product Design**
   - The product should be engineered with the possibility of growing beyond 10 million users.
   - The design should prioritize correctness first, then scalability and operational efficiency.

The challenge explicitly asks for more than a simple CRUD application. A money movement system is fundamentally a **state-transition and consistency problem**, not just a set of create/read/update/delete forms.

## 1.2 Why We Are Building It

Users expect financial-style systems to behave differently from ordinary applications:

- A failed page load must not accidentally lose money.
- A double-click must not send money twice.
- A retry after a timeout must not create a duplicate transfer.
- Two simultaneous outgoing transfers must not allow a user to spend more than their available balance.
- Transaction history must remain explainable and auditable.
- Users need clear feedback about whether a transaction succeeded, failed, or is still being processed.

The core product goal is therefore:

> **Make money movement simple for users while making state transitions strict, traceable, retry-safe, and concurrency-safe for engineers.**

## 1.3 Product Principles

1. **Correctness before convenience**
2. **Every transfer is atomic**
3. **Every write is auditable**
4. **Retries are safe**
5. **No hidden balance mutations**
6. **The UI never claims success before the backend confirms it**
7. **Failure states are explicit**
8. **Critical domain rules live in the backend, not in the client**
9. **Architecture should be easy to explain, test, extend, and operate**
10. **Complexity must earn its place**

## 1.4 Source-Grounded Scope Boundaries

The underlying challenge requires:

- A user-facing web or mobile app.
- A backend responsible for core business logic.
- Appropriate persistent data storage.
- A closed money ecosystem with simulated funds.
- No required real bank/card/payment-network integration.
- Thoughtful handling of concurrency, scalability, reliability, maintainability, and explainability.
- Technology freedom.

This PRD keeps those boundaries while expanding the solution into a production-ready design.

---

# 2. Target Users & Personas

## 2.1 Persona A — Everyday Sender

**Name:** Rahim  
**Goal:** Quickly send money to another registered user.

### Needs

- Find the right recipient safely.
- Confirm amount and recipient before sending.
- Know immediately whether the transfer succeeded.
- See the transfer in transaction history.
- Avoid duplicate transfers if the network is slow.

### Frustrations to Prevent

- Accidentally sending twice.
- Sending to the wrong person.
- Unclear error messages.
- Balance showing stale information after a transfer.

---

## 2.2 Persona B — Requester / Collector

**Name:** Nabila  
**Goal:** Request money from someone who owes her.

### Needs

- Search for a payer.
- Enter amount and optional note.
- Track whether the request is pending, accepted, declined, cancelled, or expired.
- Be credited exactly once if the payer accepts.

### Frustrations to Prevent

- Repeated payment requests by accident.
- Being unable to tell whether a request is still active.
- Acceptance succeeding twice due to repeated clicks.

---

## 2.3 Persona C — Payer Receiving Requests

**Name:** Tanvir  
**Goal:** Review and respond to incoming requests.

### Needs

- See who requested money and why.
- Accept or decline.
- See current balance before accepting.
- Receive a clear error if balance is insufficient.
- Never be charged twice.

---

## 2.4 Persona D — Operations / Support User

**Name:** Internal Support Operator  
**Goal:** Investigate transaction problems without manually altering balances.

### Needs

- Search users and transactions.
- Inspect transaction state transitions.
- Inspect ledger entries and request history.
- See idempotency keys, timestamps, request IDs, and error reason.
- Never modify financial records through ad-hoc database edits.

> Administrative balance correction is intentionally excluded from the MVP unless implemented as a separate audited adjustment workflow.

---

# 3. Core Concepts, Definitions & Invariants

This section is normative. These definitions must be used consistently across product, backend, database, API, UI, tests, and analytics.

## 3.1 User

A registered person who can authenticate and own one wallet account.

### Required properties

- Unique immutable `user_id`
- Unique normalized email and/or phone
- Display name
- Account status: `ACTIVE`, `SUSPENDED`, `CLOSED`
- Created timestamp

---

## 3.2 Wallet

A user's closed-loop balance container.

### Required properties

- One wallet per user for MVP
- Currency: `BDT`
- Current available balance stored in **integer minor units**
- Version number for concurrency control
- Status: `ACTIVE`, `FROZEN`, `CLOSED`

### Currency representation invariant

All amounts must be stored as integer minor units.

Example:

- `৳2,500.00` → `250000` poisha if two decimal places are supported.
- If the product intentionally supports whole BDT only, this decision must be fixed globally and validated consistently.

**Decision for this PRD:** store BDT as integer poisha to avoid future schema migration.

---

## 3.3 Ledger

The immutable accounting record of balance movements.

Every transfer must create balanced ledger entries.

For a transfer of `X`:

- Sender wallet ledger delta = `-X`
- Receiver wallet ledger delta = `+X`
- Sum of transfer-related ledger deltas = `0`

### Ledger invariants

1. Ledger entries are append-only.
2. Posted ledger entries are never edited or deleted.
3. A logical transfer must either post all required ledger entries or none.
4. Balance-affecting operations occur inside one database transaction.
5. Every ledger entry references the business transaction that caused it.

---

## 3.4 Transfer

A direct movement of funds from one wallet to another.

### Transfer statuses

- `PENDING`
- `SUCCEEDED`
- `FAILED`

For synchronous same-database transfers, `PENDING` may exist only briefly but remains useful for observability and future asynchronous expansion.

### Terminal statuses

- `SUCCEEDED`
- `FAILED`

### Transfer invariants

1. Sender and receiver must be different active users.
2. Amount must be greater than zero.
3. Sender wallet must have sufficient available balance.
4. A successful transfer may affect balances exactly once.
5. Replaying the same idempotent request must return the original result.
6. A failed transfer must not partially debit or credit any wallet.
7. A transfer ID is globally unique and immutable.

---

## 3.5 Money Request

A non-financial instruction asking another user to pay a specified amount.

### Request statuses

- `PENDING`
- `ACCEPTED`
- `DECLINED`
- `CANCELLED`
- `EXPIRED`

### Request invariants

1. Creating a request does **not** move money.
2. Only the requested payer may accept or decline.
3. Only the requester may cancel a pending request.
4. Only `PENDING` requests may transition to another state.
5. `ACCEPTED`, `DECLINED`, `CANCELLED`, and `EXPIRED` are terminal.
6. Accepting a request creates exactly one transfer.
7. Repeated acceptance requests must never create duplicate transfers.

---

## 3.6 Transaction

User-facing umbrella term for money movement events.

For UI purposes, the activity feed may contain:

- Direct transfers sent
- Direct transfers received
- Money requests created
- Money requests received
- Request-related transfers

The backend should preserve separate domain models for `Transfer` and `MoneyRequest`.

---

## 3.7 Idempotency Key

A unique client-generated token attached to a state-changing money operation.

### Required for

- Create transfer
- Create request
- Accept request
- Decline request
- Cancel request

### Invariant

For a given actor + endpoint + idempotency key:

- Same payload → return the original response.
- Different payload → reject with `409 IDEMPOTENCY_KEY_REUSED`.

---

## 3.8 Available Balance

The amount currently spendable by a user.

For MVP, there are no pending external settlements, so:

`available_balance = posted_balance`

If future features introduce holds/reservations, these concepts must be separated.

---

## 3.9 Atomicity

A transfer is atomic when sender debit, receiver credit, ledger records, and transfer success state all commit together.

No user-visible partial transfer is allowed.

---

## 3.10 Auditability

A business operation must be reconstructable using immutable IDs, timestamps, actors, state transitions, ledger records, and request metadata.

---

# 4. Functional Requirements & User Stories

## 4.1 MoSCoW Priority Legend

- **MUST:** Required for the product to be considered correct.
- **SHOULD:** High-value capability expected in a strong production-ready solution.
- **COULD:** Valuable extension if capacity allows.
- **WON'T (for this scope):** Explicitly excluded.

---

## 4.2 Authentication & Account

### MUST

#### FR-AUTH-001 — Register

**User story:** As a new user, I want to create an account so I can participate in the money ecosystem.

**Acceptance criteria**

- User provides required identity fields.
- Email/phone uniqueness is enforced server-side.
- Password is hashed using a modern password hashing algorithm.
- Wallet is created atomically with user creation.
- Wallet starts with configured simulated balance.
- Default seed balance is configurable; recommended initial demo value: `BDT 100,000`.

#### FR-AUTH-002 — Login

**User story:** As a registered user, I want to securely sign in.

**Acceptance criteria**

- Invalid credentials do not reveal whether an account exists.
- Authentication token/session has expiration.
- Suspended users cannot perform money operations.

#### FR-AUTH-003 — Logout

Authenticated user can invalidate local/session credentials.

### SHOULD

- Password reset.
- Email/phone verification.
- Device/session list.
- Rate limiting on login.

---

## 4.3 User Discovery

### MUST

#### FR-USER-001 — Search recipient

Users can search another active user by exact or partial supported identifier.

**Supported identifiers**

- Username
- Email
- Phone
- Display name, if enabled

**Acceptance criteria**

- Current user is excluded from selectable recipients.
- Sensitive fields are masked in results.
- Search is paginated and rate-limited.

### SHOULD

- Recently transacted users.
- Recent request counterparties.

---

## 4.4 Balance

### MUST

#### FR-WALLET-001 — View balance

Authenticated user can see current available balance.

**Acceptance criteria**

- Value comes from backend.
- Currency is clearly labeled as BDT.
- Balance refreshes after confirmed money operations.
- Stale cache must not be authoritative for transfer authorization.

---

## 4.5 Send Money

### MUST

#### FR-TRANSFER-001 — Create direct transfer

**User story:** As a sender, I want to send money to another user.

**Inputs**

- Recipient
- Amount
- Optional note
- Idempotency key

**Acceptance criteria**

- Amount > 0.
- Sender != receiver.
- Sender/receiver wallets active.
- Sufficient sender balance at commit time.
- Atomic sender debit + receiver credit.
- Transfer appears in both users' activity.
- Retry using same idempotency key does not duplicate.
- Double-click does not duplicate.
- Concurrent sends cannot overspend.
- API returns stable `transfer_id`.

#### FR-TRANSFER-002 — Transfer confirmation

Before submission, UI shows:

- Recipient name
- Masked recipient identifier
- Amount
- Optional note
- Sender's current displayed balance

User must explicitly confirm.

#### FR-TRANSFER-003 — Transfer receipt

After success, show:

- Transfer ID/reference
- Recipient
- Amount
- Timestamp
- Status
- Optional note
- Updated balance

### SHOULD

- Copy receipt/reference.
- Download/share receipt.
- Optional transfer limits.

---

## 4.6 Request Money

### MUST

#### FR-REQUEST-001 — Create money request

**User story:** As a requester, I want to ask another user to pay me.

**Acceptance criteria**

- Payer != requester.
- Amount > 0.
- No balance change occurs when request is created.
- Request receives unique `request_id`.
- Initial status = `PENDING`.

#### FR-REQUEST-002 — View incoming requests

User can see pending incoming requests with:

- Requester
- Amount
- Note
- Created time
- Status

#### FR-REQUEST-003 — Accept request

**User story:** As a payer, I want to accept a request and pay it.

**Acceptance criteria**

- Only designated payer can accept.
- Request must still be `PENDING`.
- Sufficient balance checked at commit time.
- Exactly one transfer is created.
- Request becomes `ACCEPTED`.
- Created transfer ID is linked to request.
- Repeated acceptance cannot duplicate payment.
- Concurrent accept attempts result in exactly one success.

#### FR-REQUEST-004 — Decline request

Only designated payer can decline a `PENDING` request.

#### FR-REQUEST-005 — Cancel request

Only requester can cancel their own `PENDING` request.

### SHOULD

#### FR-REQUEST-006 — Expiration

Requests may expire after configurable duration.

#### FR-REQUEST-007 — Request reminders

Manual reminder may be sent inside the application, with abuse prevention.

---

## 4.7 Activity & Transaction History

### MUST

#### FR-ACTIVITY-001 — Activity feed

Authenticated user can see paginated activity in reverse chronological order.

Each activity item includes:

- Type
- Counterparty
- Amount
- Direction (`IN`, `OUT`, `REQUEST`)
- Status
- Timestamp
- Reference ID

#### FR-ACTIVITY-002 — Transaction detail

Users can open a detail page for a transfer or request they participate in.

#### FR-ACTIVITY-003 — Authorization

A user must never retrieve transaction details for a transaction they are not party to.

### SHOULD

- Filter by date.
- Filter by sent/received/request.
- Search by transaction reference.
- Export user history as CSV.

---

## 4.8 Notifications

### SHOULD

In-app notifications for:

- Money received
- Money request received
- Money request accepted
- Money request declined
- Request cancelled/expired

### COULD

- Email notifications
- Push notifications
- SMS

External notification failure must never roll back a successful transfer.

---

## 4.9 Safety & Abuse Controls

### MUST

- Authentication required for money operations.
- Backend authorization on every protected resource.
- Amount validation.
- Rate limiting on sensitive endpoints.
- Duplicate request protection through idempotency.
- Input length limits.
- Safe logging that excludes passwords/tokens.
- Audit trail for critical actions.

### SHOULD

- Suspicious rapid-transfer detection.
- Daily simulated transfer limits.
- User suspension.
- Device/session revocation.

---

## 4.10 Operations & Support

### SHOULD

Internal read-only operations interface:

- Search user by ID/email/phone.
- Search transfer/request by ID.
- View state transitions.
- View linked ledger entries.
- View idempotency record.
- View error reason.

No direct balance editing.

---

## 4.11 WON'T — Explicitly Out of Scope

- Real bank account linking
- Card processing
- Payment gateway integration
- Cash-in/cash-out networks
- Merchant settlement
- Cross-currency exchange
- Loans
- Interest
- Investment
- Real KYC/AML integrations
- Real-world regulatory settlement
- Cryptocurrency
- Chargebacks against external institutions
- Offline money transfer

---

# 5. User Flows & Entry Points

## 5.1 Application Entry Points

### Public

1. Landing page
2. Register
3. Login
4. Forgot password, if implemented

### Authenticated

1. Home/Dashboard
2. Send Money
3. Request Money
4. Incoming Requests
5. Sent Requests
6. Activity / Transaction History
7. Transaction Detail
8. Profile / Settings
9. Notifications
10. Logout

### Internal

1. Operations login
2. User lookup
3. Transfer/request lookup
4. Audit detail

---

## 5.2 Registration Flow

`Landing → Register → Validate Input → Create User + Wallet → Seed Simulated Balance → Authentication Established → Dashboard`

### Failure paths

- Duplicate email/phone
- Weak password
- Invalid format
- Backend unavailable
- Database transaction failure

No partial user-without-wallet state is allowed.

---

## 5.3 Login Flow

`Login → Submit Credentials → Authenticate → Dashboard`

### Failure paths

- Invalid credentials
- Suspended account
- Rate-limited attempt
- Expired session

---

## 5.4 Direct Send Flow

`Dashboard → Send Money → Search Recipient → Select Recipient → Enter Amount/Note → Review → Confirm → Processing → Success Receipt`

### Backend processing

1. Authenticate sender.
2. Validate input.
3. Resolve idempotency key.
4. Start DB transaction.
5. Lock sender wallet row.
6. Lock receiver wallet row in deterministic order.
7. Revalidate account/wallet status.
8. Revalidate sufficient balance.
9. Create transfer.
10. Write debit ledger entry.
11. Write credit ledger entry.
12. Update wallet balances.
13. Mark transfer `SUCCEEDED`.
14. Commit.
15. Publish outbox event.
16. Return receipt.

### Failure paths

- Recipient unavailable
- Insufficient balance
- Same user selected
- Timeout before request reaches backend
- Timeout after backend committed
- Duplicate click
- Database conflict
- Rate limit

For ambiguous client timeouts, retry with the same idempotency key.

---

## 5.5 Request Money Flow

`Dashboard → Request Money → Search Payer → Enter Amount/Note → Review → Create → Request Detail`

### Requester actions

- Cancel while pending
- View status

### Payer flow

`Notification/Incoming Requests → Request Detail → Accept or Decline`

### Accept path

`Accept → Confirm → Processing → Transfer Succeeds → Request=ACCEPTED → Receipt`

### Accept failure paths

- Insufficient balance
- Request already accepted
- Request cancelled
- Request expired
- Request declined
- Payer account unavailable
- Retry/timeout

---

## 5.6 Activity Flow

`Dashboard → Activity → Scroll/Paginate → Select Item → Detail`

Entry points:

- Dashboard recent activity widget
- Notifications
- Request success screen
- Transfer receipt
- Search by reference, if enabled

---

## 5.7 Logout Flow

`Profile/Navigation → Logout → Session invalidated locally/server-side → Login`

---

# 6. UI/UX States

## 6.1 Global Application Shell

### Default

- Navigation visible
- Authenticated user identity
- Current balance summary
- Main content

### Loading

- Skeleton for balance and recent activity
- Navigation remains stable

### Error

- Non-destructive error banner
- Retry action
- No fake balance values

### Offline / Network unavailable

- Clear connectivity message
- Disable money submission
- Preserve unsent form input locally when safe

---

## 6.2 Balance Card

### Default

- `Available Balance`
- Formatted BDT
- Last refreshed timestamp optional

### Loading

- Skeleton placeholder

### Error

- `Balance unavailable`
- Retry button

### Empty

Not applicable: every valid user has a wallet.

---

## 6.3 Recipient Search

### Default

- Search input
- Helpful example text

### Loading

- Search spinner/skeleton

### Empty

- `No users found`

### Error

- `Could not search users`
- Retry

### Constraint state

- Prevent selecting current user

---

## 6.4 Send Money Form

### Default

- Selected recipient
- Amount
- Note
- Continue button

### Validation errors

- Amount missing
- Amount <= 0
- Amount exceeds client-displayed balance
- Recipient missing
- Note too long

Client-side validation improves UX but backend remains authoritative.

### Loading / Processing

- Submit disabled
- Single processing indicator
- Prevent repeated click
- Preserve idempotency key

### Success

- Receipt with reference

### Error

Specific messages for:

- Insufficient balance
- Recipient unavailable
- Invalid amount
- Transfer already processed
- Rate limit
- Temporary server error

For uncertain timeout:

- `We could not confirm the result yet. Checking transaction status…`
- Do **not** automatically present failure if commit may have happened.

---

## 6.5 Money Request Form

Same baseline states as Send Money, except:

- No balance sufficiency check for requester.
- Success means request created, not money received.

---

## 6.6 Incoming Requests List

### Default

- Request cards
- Amount
- Requester
- Note
- Time
- Accept/Decline

### Loading

- Skeleton list

### Empty

- `No pending requests`

### Error

- Retry

### Race-condition state

If another session resolves the request:

- Refresh
- Show final status
- Do not attempt duplicate state change

---

## 6.7 Activity Feed

### Default

- Reverse chronological list
- Clear direction and status

### Loading

- Skeleton rows

### Empty

- `No activity yet`
- CTA: Send or Request Money

### Error

- Retry without losing already loaded items

### Pagination

- Cursor-based
- Loading-more indicator
- End-of-list marker

---

## 6.8 Transaction Detail

### Default

- Status
- Amount
- Counterparty
- Reference
- Created time
- Note
- Related request ID if applicable

### Loading

- Skeleton

### Error

- Not found
- Unauthorized
- Temporary backend error

---

# 7. Edge Cases & Constraints

## 7.1 Money & Validation

1. Amount = 0
2. Negative amount
3. Decimal precision beyond supported currency precision
4. Very large amount causing integer overflow
5. Sender balance exactly equals amount
6. Sender balance is one unit below amount
7. Recipient = sender
8. Recipient suspended between selection and confirmation
9. Sender suspended between page load and confirmation
10. Wallet frozen
11. Unicode/whitespace in notes
12. Extremely long note
13. Invalid client-provided currency

---

## 7.2 Retry & Idempotency

1. Double-click Send
2. Browser retries request
3. Mobile network retry
4. Reverse proxy retry
5. Client times out after DB commit
6. Client retries same idempotency key with same payload
7. Client retries same key with different payload
8. User opens two tabs and submits same transfer

Expected result: exactly one business effect for one idempotent intent.

---

## 7.3 Concurrency

1. Two simultaneous transfers from same sender
2. Transfer and request acceptance from same payer concurrently
3. Two simultaneous accepts of same request
4. Accept vs decline race
5. Accept vs cancel race
6. Sender balance changed after confirmation screen but before submit

Expected result: database-enforced serializable business outcome without negative balances or duplicate transfer effects.

---

## 7.4 Failure & Recovery

1. Backend crashes before DB transaction starts
2. Crash during transaction
3. Crash after commit but before response
4. Notification service fails
5. Redis unavailable
6. Analytics unavailable
7. Outbox worker delayed
8. Database primary failover
9. Partial network partition

Critical principle:

> The database transaction is the source of truth for money movement. Non-critical side effects must not determine whether a transfer succeeds.

---

## 7.5 Security

1. User tampers with sender ID in request
2. User requests another user's transaction by ID
3. Reused/expired token
4. Brute-force login
5. Enumeration through search
6. Injection payloads
7. CSRF for cookie-based sessions
8. XSS in notes/display names
9. Excessive request sizes
10. Credential leakage in logs

---

## 7.6 Scalability

The source scenario explicitly anticipates possible growth beyond 10 million users.

Design implications:

- Stable opaque IDs
- Indexed lookup fields
- Cursor pagination
- No unbounded list endpoints
- Avoid cross-user fan-out in synchronous requests
- Async notifications through outbox/workers
- Cache only non-authoritative reads
- Horizontal API scaling
- Connection pooling
- Query observability
- Partition/archive strategy for very large ledger/activity tables

---

## 7.7 Product Ambiguities & Decisions

### Ambiguity A — Initial balance

The source states users **may** receive BDT 100,000 automatically.

**Decision:** Make initial simulated balance configurable. Default demo value: BDT 100,000.

### Ambiguity B — User identifier

The source does not specify email, phone, username, or another identifier.

**Decision:** Support email as required identity; phone and username may be optional. User search should support configured verified identifiers.

### Ambiguity C — Decimal support

The source shows whole-BDT examples but does not define currency precision.

**Decision:** Store integer poisha; UI may initially display two decimals or suppress `.00`.

### Ambiguity D — Request expiration

Not specified.

**Decision:** Support optional expiration in the data model; default configurable period, e.g. 7 days.

### Ambiguity E — Transfer reversal

Not specified.

**Decision:** No destructive reversal in MVP. If added later, reversal must be a new compensating transfer, never an edit/delete of the original ledger.

### Ambiguity F — Multi-currency

Not specified.

**Decision:** BDT only.

---

# 8. Success Metrics & Analytics Events

## 8.1 Product Success Metrics

### Reliability

- Successful transfer API availability: target ≥ 99.9% in production environment
- Duplicate financial effects caused by retries: target = 0
- Negative wallet balances caused by race conditions: target = 0
- Ledger imbalance incidents: target = 0

### User Experience

- Send-money completion rate
- Request-money creation completion rate
- Request acceptance completion rate
- Median time from send screen open to confirmed transfer
- User-visible transfer error rate

### System Performance

- p50/p95/p99 API latency by endpoint
- DB lock wait time
- Transfer transaction duration
- Request conflict rate
- Outbox processing lag
- Error rate by error code

### Adoption / Engagement

- Daily active users
- Transfers per active user
- Requests per active user
- Percentage of requests accepted
- Repeat sender rate

---

## 8.2 Analytics Design Rules

1. Analytics must never be the source of truth for balances or transfers.
2. Analytics failures must not block product operations.
3. Never send passwords, access tokens, full private notes, or secrets to analytics.
4. Use immutable business IDs for correlation where appropriate.
5. Record both UI funnel events and backend outcome events.

---

## 8.3 Analytics Event Catalog

| Event Name                      | Trigger                        | Required Properties                                                                                        |
| ------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `user_registered`               | Registration succeeds          | `user_id`, `registration_method`, `initial_balance_minor`, `currency`, `timestamp`                         |
| `login_succeeded`               | Login succeeds                 | `user_id`, `session_id`, `timestamp`                                                                       |
| `login_failed`                  | Login fails                    | `reason_code`, `timestamp`                                                                                 |
| `recipient_search_performed`    | User searches                  | `user_id`, `query_length`, `result_count`, `latency_ms`                                                    |
| `send_money_started`            | Send flow opened               | `user_id`, `entry_point`, `timestamp`                                                                      |
| `send_money_recipient_selected` | Recipient selected             | `user_id`, `recipient_user_id`, `timestamp`                                                                |
| `send_money_reviewed`           | Review screen shown            | `user_id`, `recipient_user_id`, `amount_minor`, `currency`                                                 |
| `transfer_submit_clicked`       | User confirms send             | `user_id`, `recipient_user_id`, `amount_minor`, `idempotency_key_hash`, `timestamp`                        |
| `transfer_succeeded`            | Backend confirms success       | `transfer_id`, `sender_user_id`, `receiver_user_id`, `amount_minor`, `currency`, `latency_ms`, `timestamp` |
| `transfer_failed`               | Backend terminal failure       | `user_id`, `reason_code`, `amount_minor`, `timestamp`                                                      |
| `transfer_retry_detected`       | Same idempotency key replayed  | `user_id`, `endpoint`, `original_status`, `timestamp`                                                      |
| `money_request_created`         | Request succeeds               | `request_id`, `requester_user_id`, `payer_user_id`, `amount_minor`, `currency`, `timestamp`                |
| `money_request_viewed`          | Request detail opened          | `request_id`, `viewer_user_id`, `request_status`, `timestamp`                                              |
| `money_request_accepted`        | Acceptance succeeds            | `request_id`, `transfer_id`, `payer_user_id`, `amount_minor`, `timestamp`                                  |
| `money_request_declined`        | Decline succeeds               | `request_id`, `payer_user_id`, `timestamp`                                                                 |
| `money_request_cancelled`       | Cancellation succeeds          | `request_id`, `requester_user_id`, `timestamp`                                                             |
| `money_request_expired`         | Expiry job transitions request | `request_id`, `expired_at`                                                                                 |
| `activity_feed_opened`          | Activity page opens            | `user_id`, `entry_point`, `timestamp`                                                                      |
| `transaction_detail_opened`     | Detail opens                   | `user_id`, `resource_type`, `resource_id`, `timestamp`                                                     |
| `insufficient_balance_shown`    | Backend returns insufficiency  | `user_id`, `operation_type`, `requested_amount_minor`, `timestamp`                                         |
| `api_error_presented`           | User sees backend error        | `user_id`, `endpoint_group`, `error_code`, `request_id`, `timestamp`                                       |

---

## 8.4 Acceptance Definition for Product Readiness

The core product is ready when all MUST requirements pass and the following invariants are demonstrated by automated tests:

1. A transfer never partially completes.
2. The same idempotent request never creates two successful financial effects.
3. Two concurrent operations cannot overspend a wallet.
4. A money request can be accepted at most once.
5. Unauthorized users cannot read or mutate another user's private transaction resources.
6. Every successful money transfer has balanced immutable ledger entries.
7. Transaction history is consistent with committed business state.
8. Failure of notification/analytics systems cannot corrupt or roll back committed money movement.
