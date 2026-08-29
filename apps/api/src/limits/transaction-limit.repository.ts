import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

export interface SentTotals {
  dailyMinor: bigint;
  weeklyMinor: bigint;
  monthlyMinor: bigint;
}

interface SentTotalsRow {
  daily_minor: bigint;
  weekly_minor: bigint;
  monthly_minor: bigint;
}

/**
 * Reads how much a user has already sent in each rolling window. One query
 * computes all three sums together (`FILTER`, standard Postgres) rather than
 * three separate round trips, and reuses the existing
 * `idx_transfers_sender_created (sender_user_id, created_at DESC, id DESC)`
 * index for the range scan bounded by the widest window.
 *
 * Only SUCCEEDED transfers count — an attempt that failed (insufficient
 * balance, a limit already hit, a rolled-back transaction) never moved money,
 * so it never used any of the sender's allowance.
 */
@Injectable()
export class TransactionLimitRepository {
  constructor(private readonly prisma: PrismaService) {}

  async sumSentByWindow(
    db: PrismaService | Prisma.TransactionClient,
    senderUserId: string,
    windows: { dailySince: Date; weeklySince: Date; monthlySince: Date },
  ): Promise<SentTotals> {
    const rows = await db.$queryRaw<SentTotalsRow[]>`
      SELECT
        COALESCE(SUM(amount_minor) FILTER (WHERE created_at >= ${windows.dailySince}), 0)::bigint AS daily_minor,
        COALESCE(SUM(amount_minor) FILTER (WHERE created_at >= ${windows.weeklySince}), 0)::bigint AS weekly_minor,
        COALESCE(SUM(amount_minor) FILTER (WHERE created_at >= ${windows.monthlySince}), 0)::bigint AS monthly_minor
      FROM transfers
      WHERE sender_user_id = ${senderUserId}::uuid
        AND status = 'SUCCEEDED'
        AND created_at >= ${windows.monthlySince}
    `;

    const row = rows[0];
    return {
      dailyMinor: BigInt(row?.daily_minor ?? 0n),
      weeklyMinor: BigInt(row?.weekly_minor ?? 0n),
      monthlyMinor: BigInt(row?.monthly_minor ?? 0n),
    };
  }

  /** Read-path convenience for `GET /wallet` — same query, no transaction. */
  sumSentByWindowForRead(
    senderUserId: string,
    windows: { dailySince: Date; weeklySince: Date; monthlySince: Date },
  ): Promise<SentTotals> {
    return this.sumSentByWindow(this.prisma, senderUserId, windows);
  }
}
