-- Milestone — Money requests (IMPLEMENTATION_GUIDE.md §2.6 / §3.9–§3.14).
-- Creating a request never moves money; only accept does, via the transfer
-- domain. Terminal states never transition again.

-- CreateEnum
CREATE TYPE "MoneyRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "money_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "requester_user_id" UUID NOT NULL,
    "payer_user_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'BDT',
    "note" VARCHAR(280),
    "status" "MoneyRequestStatus" NOT NULL DEFAULT 'PENDING',
    "accepted_transfer_id" UUID,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "money_requests_pkey" PRIMARY KEY ("id"),
    -- Last-line database guards behind MoneyRequestService validation.
    CONSTRAINT "money_requests_amount_minor_positive" CHECK ("amount_minor" > 0),
    CONSTRAINT "money_requests_distinct_parties" CHECK ("requester_user_id" <> "payer_user_id"),
    -- Invariant 9.3: an ACCEPTED request always carries its settling transfer.
    CONSTRAINT "money_requests_accepted_has_transfer" CHECK (
        ("status" <> 'ACCEPTED') OR ("accepted_transfer_id" IS NOT NULL)
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "money_requests_accepted_transfer_id_key" ON "money_requests"("accepted_transfer_id");

-- CreateIndex
CREATE INDEX "idx_money_requests_payer_created" ON "money_requests"("payer_user_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "idx_money_requests_requester_created" ON "money_requests"("requester_user_id", "created_at" DESC, "id" DESC);

-- AddForeignKey
ALTER TABLE "money_requests" ADD CONSTRAINT "money_requests_requester_user_id_fkey" FOREIGN KEY ("requester_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "money_requests" ADD CONSTRAINT "money_requests_payer_user_id_fkey" FOREIGN KEY ("payer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "money_requests" ADD CONSTRAINT "money_requests_accepted_transfer_id_fkey" FOREIGN KEY ("accepted_transfer_id") REFERENCES "transfers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- `transfers.source_request_id` predates this table; wire its referential
-- integrity now that the target exists (invariant 9.4).
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_source_request_id_fkey" FOREIGN KEY ("source_request_id") REFERENCES "money_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
