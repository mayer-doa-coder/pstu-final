import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { KeysetCursor } from '../common/pagination/cursor.util';
import { PrismaService } from '../database/prisma.service';

export type ActivityKind = 'transfer' | 'money_request';

export interface ActivityRow {
  kind: ActivityKind;
  referenceId: string;
  createdAt: Date;
  direction: 'IN' | 'OUT' | 'REQUEST';
  amountMinor: bigint;
  currency: string;
  status: string;
  /** Only ever set for money-request rows; lets the read model derive EXPIRED. */
  expiresAt: Date | null;
  counterpartyId: string;
  relatedRequestId: string | null;
  relatedTransferId: string | null;
}

interface ActivityRawRow {
  kind: ActivityKind;
  reference_id: string;
  created_at: Date;
  direction: 'IN' | 'OUT' | 'REQUEST';
  amount_minor: bigint;
  currency: string;
  status: string;
  expires_at: Date | null;
  counterparty_id: string;
  related_request_id: string | null;
  related_transfer_id: string | null;
}

export interface ActivityQueryCriteria {
  userId: string;
  cursor?: KeysetCursor;
  kind?: ActivityKind;
  /** Callers pass `pageSize + 1` to detect a next page without a count query. */
  take: number;
}

/**
 * Read-only activity aggregation. A single `UNION ALL` over the two source
 * tables — transfers the user is party to, and money requests the user is
 * party to — paginated by the same `(created_at, id)` keyset as the rest of
 * the system. One query per page (plus one batched counterparty lookup in
 * the service), never per row: no N+1 at any page size
 * (IMPLEMENTATION_GUIDE.md §3.8 / §7, Risk 7).
 */
@Injectable()
export class ActivityRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(criteria: ActivityQueryCriteria): Promise<ActivityRow[]> {
    const { userId, cursor, kind, take } = criteria;

    // Keyset predicate: strictly "older than" the cursor anchor in the same
    // (created_at DESC, id DESC) order the query returns — stable even when
    // rows share a timestamp because `reference_id` breaks the tie.
    const cursorClause = cursor
      ? Prisma.sql`AND (act.created_at, act.reference_id) < (${cursor.createdAt}, ${cursor.id}::uuid)`
      : Prisma.empty;
    const kindClause = kind ? Prisma.sql`AND act.kind = ${kind}` : Prisma.empty;

    const rows = await this.prisma.$queryRaw<ActivityRawRow[]>(Prisma.sql`
      SELECT act.kind, act.reference_id, act.created_at, act.direction, act.amount_minor,
             act.currency, act.status, act.expires_at, act.counterparty_id,
             act.related_request_id, act.related_transfer_id
      FROM (
        SELECT 'transfer' AS kind, t.id AS reference_id, t.created_at AS created_at,
               CASE WHEN t.sender_user_id = ${userId}::uuid THEN 'OUT' ELSE 'IN' END AS direction,
               t.amount_minor AS amount_minor, t.currency AS currency,
               t.status::text AS status,
               NULL::timestamp AS expires_at,
               CASE WHEN t.sender_user_id = ${userId}::uuid
                    THEN t.receiver_user_id ELSE t.sender_user_id END AS counterparty_id,
               t.source_request_id AS related_request_id,
               NULL::uuid AS related_transfer_id
        FROM transfers t
        WHERE t.sender_user_id = ${userId}::uuid OR t.receiver_user_id = ${userId}::uuid

        UNION ALL

        SELECT 'money_request' AS kind, r.id AS reference_id, r.created_at AS created_at,
               'REQUEST' AS direction,
               r.amount_minor AS amount_minor, r.currency AS currency,
               r.status::text AS status,
               r.expires_at AS expires_at,
               CASE WHEN r.requester_user_id = ${userId}::uuid
                    THEN r.payer_user_id ELSE r.requester_user_id END AS counterparty_id,
               r.id AS related_request_id,
               r.accepted_transfer_id AS related_transfer_id
        FROM money_requests r
        WHERE r.requester_user_id = ${userId}::uuid OR r.payer_user_id = ${userId}::uuid
      ) act
      WHERE true ${cursorClause} ${kindClause}
      ORDER BY act.created_at DESC, act.reference_id DESC
      LIMIT ${take}
    `);

    return rows.map((row) => ({
      kind: row.kind,
      referenceId: row.reference_id,
      createdAt: row.created_at,
      direction: row.direction,
      amountMinor: row.amount_minor,
      currency: row.currency.trim(),
      status: row.status,
      expiresAt: row.expires_at,
      counterpartyId: row.counterparty_id,
      relatedRequestId: row.related_request_id,
      relatedTransferId: row.related_transfer_id,
    }));
  }
}
