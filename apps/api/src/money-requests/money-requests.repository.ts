import { Injectable } from '@nestjs/common';
import { type MoneyRequest, type MoneyRequestStatus, Prisma } from '@prisma/client';
import type { KeysetCursor } from '../common/pagination/cursor.util';
import { PrismaService } from '../database/prisma.service';

export type ParticipantRole = 'payer' | 'requester';

export interface CreateMoneyRequestData {
  requesterUserId: string;
  payerUserId: string;
  amountMinor: bigint;
  currency: string;
  note: string | null;
  expiresAt: Date | null;
}

export interface ListMoneyRequestsCriteria {
  role: ParticipantRole;
  userId: string;
  /** Filters on the *stored* status (an un-swept elapsed row still reads as PENDING here). */
  status?: MoneyRequestStatus;
  cursor?: KeysetCursor;
  /** Callers pass `pageSize + 1` to detect a next page without a count query. */
  take: number;
}

/**
 * All `money_requests` persistence. Every mutating method takes an explicit
 * `Prisma.TransactionClient` (no default) — a state transition is only ever
 * valid inside the transaction that also holds the row's `FOR UPDATE` lock.
 * This module NEVER writes wallet balances or ledger rows (AGENT.md §3).
 */
@Injectable()
export class MoneyRequestsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(tx: Prisma.TransactionClient, data: CreateMoneyRequestData): Promise<MoneyRequest> {
    return tx.moneyRequest.create({
      data: {
        requesterUserId: data.requesterUserId,
        payerUserId: data.payerUserId,
        amountMinor: data.amountMinor,
        currency: data.currency,
        note: data.note,
        expiresAt: data.expiresAt,
        status: 'PENDING',
      },
    });
  }

  /**
   * Take the request row's `FOR UPDATE` lock, then return its current row.
   * Accept / decline / cancel all call this first: the lock serializes those
   * three code paths against each other so exactly one of them can observe
   * `PENDING` and drive the single terminal transition (invariant 9.3, AC-4).
   * A `FOR UPDATE` waiter re-reads the post-commit row, so the follow-up
   * `findUnique` reflects whatever the winning transaction just wrote.
   */
  async lockById(tx: Prisma.TransactionClient, id: string): Promise<MoneyRequest | null> {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM money_requests WHERE id = ${id}::uuid FOR UPDATE
    `;
    if (locked.length === 0) {
      return null;
    }
    return tx.moneyRequest.findUnique({ where: { id } });
  }

  /** Read path for `GET /money-requests/:id` — no transaction, no lock. */
  findById(id: string): Promise<MoneyRequest | null> {
    return this.prisma.moneyRequest.findUnique({ where: { id } });
  }

  /** PENDING -> ACCEPTED, linking the transfer that settled it. */
  markAccepted(
    tx: Prisma.TransactionClient,
    id: string,
    acceptedTransferId: string,
  ): Promise<MoneyRequest> {
    return tx.moneyRequest.update({
      where: { id },
      data: { status: 'ACCEPTED', acceptedTransferId, resolvedAt: new Date() },
    });
  }

  /** PENDING -> DECLINED | CANCELLED. No money moves. */
  markResolved(
    tx: Prisma.TransactionClient,
    id: string,
    status: 'DECLINED' | 'CANCELLED',
  ): Promise<MoneyRequest> {
    return tx.moneyRequest.update({
      where: { id },
      data: { status, resolvedAt: new Date() },
    });
  }

  /**
   * Keyset-paginated list for one participant. Ordered `(created_at DESC,
   * id DESC)` to match the covering index and give a stable cursor when two
   * rows share a timestamp.
   */
  listForParticipant(criteria: ListMoneyRequestsCriteria): Promise<MoneyRequest[]> {
    const ownerFilter =
      criteria.role === 'payer'
        ? { payerUserId: criteria.userId }
        : { requesterUserId: criteria.userId };

    return this.prisma.moneyRequest.findMany({
      where: {
        ...ownerFilter,
        ...(criteria.status ? { status: criteria.status } : {}),
        ...(criteria.cursor
          ? {
              OR: [
                { createdAt: { lt: criteria.cursor.createdAt } },
                { createdAt: criteria.cursor.createdAt, id: { lt: criteria.cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: criteria.take,
    });
  }
}
