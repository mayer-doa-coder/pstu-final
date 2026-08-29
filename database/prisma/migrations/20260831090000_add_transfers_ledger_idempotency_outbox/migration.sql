-- Milestone 3 — Direct transfer core: transfers, ledger_entries,
-- idempotency_records, outbox_events. See IMPLEMENTATION_GUIDE.md §2.4–§2.8.

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "TransferSourceType" AS ENUM ('DIRECT', 'MONEY_REQUEST');

-- CreateEnum
CREATE TYPE "LedgerDirection" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "IdempotencyState" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "transfers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sender_user_id" UUID NOT NULL,
    "receiver_user_id" UUID NOT NULL,
    "sender_wallet_id" UUID NOT NULL,
    "receiver_wallet_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'BDT',
    "status" "TransferStatus" NOT NULL DEFAULT 'PENDING',
    "note" VARCHAR(280),
    "source_type" "TransferSourceType" NOT NULL DEFAULT 'DIRECT',
    "source_request_id" UUID,
    "failure_code" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "transfers_pkey" PRIMARY KEY ("id"),
    -- Money is always a positive integer amount; self-transfers are impossible.
    -- Last-line database guards behind the domain validation in TransferService.
    CONSTRAINT "transfers_amount_minor_positive" CHECK ("amount_minor" > 0),
    CONSTRAINT "transfers_distinct_parties" CHECK ("sender_user_id" <> "receiver_user_id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "transfer_id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "direction" "LedgerDirection" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "signed_amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "balance_after_minor" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ledger_entries_amount_minor_positive" CHECK ("amount_minor" > 0),
    -- The signed amount must agree with the direction, so SUM(signed_amount_minor)
    -- over a balanced transfer is always exactly 0 (IMPLEMENTATION_GUIDE.md §9.1).
    CONSTRAINT "ledger_entries_signed_amount_matches_direction" CHECK (
        ("direction" = 'DEBIT' AND "signed_amount_minor" = - "amount_minor")
        OR ("direction" = 'CREDIT' AND "signed_amount_minor" = "amount_minor")
    )
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_user_id" UUID NOT NULL,
    "route_key" VARCHAR(80) NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "state" "IdempotencyState" NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "resource_type" VARCHAR(32),
    "resource_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "aggregate_type" VARCHAR(32) NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "event_type" VARCHAR(80) NOT NULL,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_transfers_sender_created" ON "transfers"("sender_user_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "idx_transfers_receiver_created" ON "transfers"("receiver_user_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "idx_transfers_request" ON "transfers"("source_request_id");

-- CreateIndex
CREATE INDEX "idx_ledger_wallet_created" ON "ledger_entries"("wallet_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "idx_ledger_transfer" ON "ledger_entries"("transfer_id");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_actor_route_key_key" ON "idempotency_records"("actor_user_id", "route_key", "idempotency_key");

-- CreateIndex
CREATE INDEX "idx_outbox_unprocessed" ON "outbox_events"("occurred_at");

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_receiver_user_id_fkey" FOREIGN KEY ("receiver_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_sender_wallet_id_fkey" FOREIGN KEY ("sender_wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_receiver_wallet_id_fkey" FOREIGN KEY ("receiver_wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "transfers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
