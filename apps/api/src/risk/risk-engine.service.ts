import { Injectable } from '@nestjs/common';
import type { RiskLevel, VerificationStatus } from '@prisma/client';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const LARGE_ABSOLUTE_AMOUNT_MINOR = 50_000_000n; // BDT 500,000
const ROUND_AMOUNT_STEP_MINOR = 5_000_000n; // BDT 50,000
const HIGH_VELOCITY_THRESHOLD = 5;

/** How far back the velocity rule counts a sender's prior transfers — exported so the caller computing `senderRecentTransferCount` uses the same window. */
export const HIGH_VELOCITY_WINDOW_MINUTES = 10;

/** MEDIUM at 25+, HIGH at 50+ — see the rule weights below for how a score is built. */
const MEDIUM_THRESHOLD = 25;
const HIGH_THRESHOLD = 50;

export interface RiskContext {
  amountMinor: bigint;
  /** Sender's wallet balance immediately before this transfer. */
  senderBalanceBeforeMinor: bigint;
  senderCreatedAt: Date;
  receiverCreatedAt: Date;
  senderVerificationStatus: VerificationStatus;
  /** Sender's SUCCEEDED transfer count in the engine's velocity window. */
  senderRecentTransferCount: number;
  now: Date;
}

export interface RiskEvaluation {
  score: number;
  level: RiskLevel;
  /** Human-readable, in the order the rules fired — this is the audit trail's "why". */
  reasons: string[];
}

interface RiskRule {
  weight: number;
  reason: string;
  fires: (ctx: RiskContext) => boolean;
}

/**
 * Seven deterministic, independently-understandable signals. Each is a plain
 * threshold on data already available from the transfer's own locked wallet
 * rows plus one velocity count — no external call, no ML model, nothing that
 * could make the same input produce a different score on a different day.
 */
const RULES: readonly RiskRule[] = [
  {
    reason: "Amount is a large share of the sender's available balance.",
    weight: 25,
    // amountMinor / balanceBefore >= 0.7, computed in integers to avoid float
    // rounding: amount*10 >= balance*7.
    fires: (ctx) =>
      ctx.senderBalanceBeforeMinor > 0n &&
      ctx.amountMinor * 10n >= ctx.senderBalanceBeforeMinor * 7n,
  },
  {
    reason: 'Transfer amount is unusually large.',
    weight: 20,
    fires: (ctx) => ctx.amountMinor >= LARGE_ABSOLUTE_AMOUNT_MINOR,
  },
  {
    reason: 'Sender account was created less than 24 hours ago.',
    weight: 15,
    fires: (ctx) => ctx.now.getTime() - ctx.senderCreatedAt.getTime() < ONE_DAY_MS,
  },
  {
    reason: 'Sender has not completed NID verification.',
    weight: 15,
    fires: (ctx) => ctx.senderVerificationStatus !== 'VERIFIED',
  },
  {
    reason: 'Receiver account was created less than 24 hours ago.',
    weight: 10,
    fires: (ctx) => ctx.now.getTime() - ctx.receiverCreatedAt.getTime() < ONE_DAY_MS,
  },
  {
    reason: 'Amount is a suspiciously round figure.',
    weight: 10,
    fires: (ctx) =>
      ctx.amountMinor >= ROUND_AMOUNT_STEP_MINOR &&
      ctx.amountMinor % ROUND_AMOUNT_STEP_MINOR === 0n,
  },
  {
    reason: 'Sender has made several transfers in a short time window.',
    weight: 25,
    fires: (ctx) => ctx.senderRecentTransferCount >= HIGH_VELOCITY_THRESHOLD,
  },
];

/**
 * Deterministic fraud/risk scoring for a transfer. Pure function of its
 * input — no I/O — so it is fully unit-testable and, given identical inputs,
 * always produces an identical score: an investigator can always reproduce
 * why a transfer was flagged.
 *
 * This is detection, not prevention: it never throws and never blocks a
 * transfer. TransferService records the result inside the same transaction
 * as the money movement regardless of level, so LOW-scoring transfers get a
 * complete audit trail too, not just the flagged ones.
 */
@Injectable()
export class RiskEngineService {
  evaluate(context: RiskContext): RiskEvaluation {
    const fired = RULES.filter((rule) => rule.fires(context));
    const score = fired.reduce((total, rule) => total + rule.weight, 0);

    const level: RiskLevel =
      score >= HIGH_THRESHOLD ? 'HIGH' : score >= MEDIUM_THRESHOLD ? 'MEDIUM' : 'LOW';

    return { score, level, reasons: fired.map((rule) => rule.reason) };
  }
}
