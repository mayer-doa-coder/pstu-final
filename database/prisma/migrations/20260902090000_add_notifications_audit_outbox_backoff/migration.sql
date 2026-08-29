-- Reliability bundle — outbox retry backoff, in-app notifications, audit trail.
-- See IMPLEMENTATION_GUIDE.md §2.8–§2.10 and §6.

-- AlterTable: bounded-retry gate for the outbox worker. Existing unprocessed
-- rows become immediately claimable (default now()), which is correct — they
-- have simply been waiting for a worker to exist.
ALTER TABLE "outbox_events"
    ADD COLUMN "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- The worker only ever scans unprocessed rows, so make the index partial:
-- processed history (the vast majority of the table over time) stays out of it.
DROP INDEX IF EXISTS "idx_outbox_unprocessed";
CREATE INDEX "idx_outbox_unprocessed" ON "outbox_events"("next_attempt_at", "occurred_at")
    WHERE "processed_at" IS NULL;

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "type" VARCHAR(64) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "body" VARCHAR(500) NOT NULL,
    "resource_type" VARCHAR(32),
    "resource_id" UUID,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source_event_id" UUID NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_user_id" UUID,
    "action" VARCHAR(80) NOT NULL,
    "resource_type" VARCHAR(32) NOT NULL,
    "resource_id" UUID,
    "request_id" VARCHAR(128),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Outbox delivery is at-least-once, so this UNIQUE index — not application
-- logic — is what makes re-processing an event produce no duplicate.
CREATE UNIQUE INDEX "notifications_source_event_user_key" ON "notifications"("source_event_id", "user_id");

-- CreateIndex
CREATE INDEX "idx_notifications_user_created" ON "notifications"("user_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "idx_audit_actor_created" ON "audit_events"("actor_user_id", "created_at" DESC);

-- CreateIndex: investigate by transfer/request id.
CREATE INDEX "idx_audit_resource" ON "audit_events"("resource_type", "resource_id");

-- CreateIndex: investigate by correlation id.
CREATE INDEX "idx_audit_request" ON "audit_events"("request_id");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
