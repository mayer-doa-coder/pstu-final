import { Injectable } from '@nestjs/common';
import type { Prisma, RiskAssessment, RiskLevel } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

export interface InsertRiskAssessmentData {
  transferId: string;
  score: number;
  level: RiskLevel;
  reasons: string[];
}

/**
 * All `risk_assessments` persistence, plus the one supporting query the
 * engine needs (recent transfer velocity). `insertAssessment` takes an
 * explicit `tx` (no default) — it is only ever written inside the same
 * transaction as the transfer it scores.
 */
@Injectable()
export class RiskRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** SUCCEEDED transfers sent by this user since `sinceDate` — the velocity signal. */
  countRecentTransfersFromSender(
    tx: Prisma.TransactionClient,
    senderUserId: string,
    sinceDate: Date,
  ): Promise<number> {
    return tx.transfer.count({
      where: { senderUserId, status: 'SUCCEEDED', createdAt: { gte: sinceDate } },
    });
  }

  insertAssessment(
    tx: Prisma.TransactionClient,
    data: InsertRiskAssessmentData,
  ): Promise<RiskAssessment> {
    return tx.riskAssessment.create({
      data: {
        transferId: data.transferId,
        score: data.score,
        level: data.level,
        reasons: data.reasons,
      },
    });
  }

  findByTransferId(transferId: string): Promise<RiskAssessment | null> {
    return this.prisma.riskAssessment.findUnique({ where: { transferId } });
  }

  /**
   * Best-effort, out-of-transaction write for the optional LLM explanation.
   * `updateMany` (not `update`) so a transfer that somehow has no assessment
   * row yet is a silent no-op rather than a throw — this always runs after
   * the transfer's own transaction has already committed.
   */
  async setExplanation(transferId: string, explanation: string): Promise<void> {
    await this.prisma.riskAssessment.updateMany({
      where: { transferId },
      data: { explanation },
    });
  }
}
