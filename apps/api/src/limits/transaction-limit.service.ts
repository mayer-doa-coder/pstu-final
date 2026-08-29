import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AppException } from '../common/exceptions/app.exception';
import { ErrorCode } from '../common/exceptions/error-code.enum';
import { AppConfigService } from '../config/app-config.service';
import { TransactionLimitRepository } from './transaction-limit.repository';
import type { LimitUsageDto, LimitWindowDto } from './dto/limit-usage.dto';

const DAY_MS = 24 * 60 * 60 * 1000;

type Period = 'daily' | 'weekly' | 'monthly';

/**
 * Per-user rolling send limits — daily, weekly, monthly — enforced wherever
 * money actually leaves a wallet. Rolling (now minus N) rather than
 * calendar-aligned (midnight/Monday/1st) on purpose: a calendar reset would
 * need a scheduled sweep with its own failure modes, and "the last 24 hours"
 * is no less real a limit than "since midnight".
 *
 * Independent windows: a transfer must fit under all three simultaneously,
 * since a daily cap alone can't stop someone splitting one large transfer
 * across many days to blow through a monthly ceiling.
 */
@Injectable()
export class TransactionLimitService {
  constructor(
    private readonly repository: TransactionLimitRepository,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Re-validated inside the transfer's DB transaction, after the wallet locks
   * are held — same invariant as the balance check (CLAUDE.md: limits must be
   * checked against current state under the lock, not an earlier screen).
   * Throws `TRANSFER_LIMIT_EXCEEDED` (409) if any window would be exceeded;
   * never partially applies — the whole transfer rolls back like any other
   * mid-transaction rejection.
   */
  async assertWithinLimits(
    tx: Prisma.TransactionClient,
    senderUserId: string,
    amountMinor: bigint,
    now: Date = new Date(),
  ): Promise<void> {
    const totals = await this.repository.sumSentByWindow(tx, senderUserId, this.windowsSince(now));

    this.assertWindow('daily', totals.dailyMinor, amountMinor, this.config.dailyTransferLimitMinor);
    this.assertWindow(
      'weekly',
      totals.weeklyMinor,
      amountMinor,
      this.config.weeklyTransferLimitMinor,
    );
    this.assertWindow(
      'monthly',
      totals.monthlyMinor,
      amountMinor,
      this.config.monthlyTransferLimitMinor,
    );
  }

  /** Read path for `GET /wallet` — current usage and headroom, no enforcement. */
  async getUsage(userId: string, now: Date = new Date()): Promise<LimitUsageDto> {
    const totals = await this.repository.sumSentByWindowForRead(userId, this.windowsSince(now));

    return {
      daily: this.toWindowDto(totals.dailyMinor, this.config.dailyTransferLimitMinor),
      weekly: this.toWindowDto(totals.weeklyMinor, this.config.weeklyTransferLimitMinor),
      monthly: this.toWindowDto(totals.monthlyMinor, this.config.monthlyTransferLimitMinor),
    };
  }

  private windowsSince(now: Date): { dailySince: Date; weeklySince: Date; monthlySince: Date } {
    return {
      dailySince: new Date(now.getTime() - DAY_MS),
      weeklySince: new Date(now.getTime() - 7 * DAY_MS),
      monthlySince: new Date(now.getTime() - 30 * DAY_MS),
    };
  }

  private assertWindow(
    period: Period,
    usedMinor: bigint,
    amountMinor: bigint,
    limitMinor: bigint,
  ): void {
    if (usedMinor + amountMinor <= limitMinor) {
      return;
    }

    throw new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.TRANSFER_LIMIT_EXCEEDED,
      `This transfer would exceed your ${period} transfer limit.`,
      {
        period,
        limitMinor: Number(limitMinor),
        usedMinor: Number(usedMinor),
        amountMinor: Number(amountMinor),
      },
    );
  }

  private toWindowDto(usedMinor: bigint, limitMinor: bigint): LimitWindowDto {
    const remaining = limitMinor - usedMinor;
    return {
      limitMinor: Number(limitMinor),
      usedMinor: Number(usedMinor),
      // Never negative in the response, even though a limit is only ever
      // checked at write time — usage can't retroactively exceed it, but this
      // keeps the DTO honest if the configured limit is ever lowered.
      remainingMinor: Number(remaining > 0n ? remaining : 0n),
    };
  }
}
