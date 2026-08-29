-- Account verification (simulated NID/KYC) and the deterministic fraud/risk
-- engine. Neither touches the money-movement tables' write paths — risk_assessments
-- is populated inside the same transaction as a transfer, but adds no new
-- constraint that could block one.

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- AlterTable
ALTER TABLE "users"
    ADD COLUMN "nid_hash" CHAR(64),
    ADD COLUMN "nid_masked" VARCHAR(20),
    ADD COLUMN "verification_status" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    ADD COLUMN "verified_at" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "users_nid_hash_key" ON "users"("nid_hash");

-- CreateTable
CREATE TABLE "risk_assessments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "transfer_id" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "level" "RiskLevel" NOT NULL,
    "reasons" JSONB NOT NULL,
    "explanation" VARCHAR(600),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "risk_assessments_transfer_id_key" ON "risk_assessments"("transfer_id");

-- CreateIndex
CREATE INDEX "idx_risk_assessments_level_created" ON "risk_assessments"("level", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "risk_assessments" ADD CONSTRAINT "risk_assessments_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "transfers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
