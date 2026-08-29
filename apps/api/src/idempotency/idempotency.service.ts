import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppException } from '../common/exceptions/app.exception';
import { ErrorCode } from '../common/exceptions/error-code.enum';
import { hashRequestPayload } from './request-hash.util';

/** How long a completed idempotency record stays replayable. */
const RECORD_TTL = '24 hours';

export interface BeginParams {
  actorUserId: string;
  /** Stable identifier for the endpoint, e.g. `POST:/transfers`. */
  routeKey: string;
  idempotencyKey: string;
  /** The canonical request payload — hashed to detect same-key/different-body reuse. */
  payload: unknown;
}

export interface CompleteParams {
  recordId: string;
  responseStatus: number;
  /** The canonical response DTO. Must be plain JSON (no bigint) so it round-trips through JSONB. */
  responseBody: unknown;
  resourceType: string;
  resourceId: string;
}

export type BeginResult =
  | { replayed: false; recordId: string }
  | { replayed: true; responseStatus: number; responseBody: unknown };

interface ExistingRecordRow {
  id: string;
  request_hash: string;
  state: string;
  response_status: number | null;
  response_body: unknown;
}

/**
 * Durable idempotency for state-changing money operations
 * (IMPLEMENTATION_GUIDE.md §1.6). Every method runs *inside* the caller's DB
 * transaction (`tx`), so claiming a key, moving the money, and recording the
 * canonical response either all commit together or all roll back together —
 * a half-processed request can never leave a "COMPLETED" record behind.
 *
 * The uniqueness boundary is `(actorUserId, routeKey, idempotencyKey)`,
 * enforced by a UNIQUE index in PostgreSQL — not application code, and never
 * Redis.
 */
@Injectable()
export class IdempotencyService {
  /**
   * Claim the key for processing, or resolve what a concurrent/earlier
   * request already did with it.
   *
   *  - key unseen            -> insert PROCESSING row, return { replayed: false }
   *  - key seen, same body   -> return the stored canonical response
   *  - key seen, diff body   -> 409 IDEMPOTENCY_KEY_REUSED
   *
   * Concurrency: two requests with the same key race to `INSERT ... ON
   * CONFLICT DO NOTHING`. The loser then takes a `FOR UPDATE` lock on the
   * winner's row, which blocks until the winner's transaction commits (row
   * visible, state COMPLETED -> replay) or rolls back (row gone -> the loser
   * retries the claim and processes it itself).
   */
  async begin(tx: Prisma.TransactionClient, params: BeginParams): Promise<BeginResult> {
    const requestHash = hashRequestPayload(params.payload);

    // Bounded: the only reason to loop is "the previous holder rolled back
    // between our claim attempt and our lock", which resolves in one retry.
    for (let attempt = 0; attempt < 3; attempt++) {
      const claimed = await this.tryClaim(tx, params, requestHash);
      if (claimed) {
        return { replayed: false, recordId: claimed };
      }

      const existing = await this.lockExisting(tx, params);
      if (!existing) {
        // Holder's transaction rolled back; its PROCESSING row vanished with
        // it. Loop and try to claim the key ourselves.
        continue;
      }

      if (existing.request_hash !== requestHash) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.IDEMPOTENCY_KEY_REUSED,
          'This Idempotency-Key was already used with a different request payload.',
        );
      }

      if (existing.state === 'COMPLETED') {
        return {
          replayed: true,
          responseStatus: existing.response_status ?? HttpStatus.OK,
          responseBody: existing.response_body,
        };
      }

      // A non-terminal row we now hold the lock on: the prior attempt neither
      // completed nor rolled back its record (e.g. a crash). Its financial
      // effects rolled back with its transaction, so it is safe to take over.
      await this.reclaim(tx, existing.id, requestHash);
      return { replayed: false, recordId: existing.id };
    }

    throw new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.IDEMPOTENCY_KEY_REUSED,
      'This Idempotency-Key is currently being processed. Retry shortly.',
    );
  }

  /**
   * Record the canonical outcome on the PROCESSING row. Called as the last
   * step before the domain transaction commits, so the stored response is
   * only ever visible once the money movement it describes has also
   * committed.
   */
  async complete(tx: Prisma.TransactionClient, params: CompleteParams): Promise<void> {
    await tx.idempotencyRecord.update({
      where: { id: params.recordId },
      data: {
        state: 'COMPLETED',
        responseStatus: params.responseStatus,
        responseBody: params.responseBody as Prisma.InputJsonValue,
        resourceType: params.resourceType,
        resourceId: params.resourceId,
      },
    });
  }

  /**
   * `INSERT ... ON CONFLICT DO NOTHING` — atomic "claim if unseen". Returns
   * the new record id, or null if the key already exists. Raw SQL because
   * Prisma has no ON CONFLICT primitive, and a caught unique-violation would
   * poison the surrounding transaction.
   */
  private async tryClaim(
    tx: Prisma.TransactionClient,
    params: BeginParams,
    requestHash: string,
  ): Promise<string | null> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO idempotency_records
        (id, actor_user_id, route_key, idempotency_key, request_hash, state, created_at, expires_at)
      VALUES
        (gen_random_uuid(), ${params.actorUserId}::uuid, ${params.routeKey}, ${params.idempotencyKey},
         ${requestHash}, 'PROCESSING', now(), now() + ${RECORD_TTL}::interval)
      ON CONFLICT (actor_user_id, route_key, idempotency_key) DO NOTHING
      RETURNING id::text
    `;

    return rows[0]?.id ?? null;
  }

  /**
   * `SELECT ... FOR UPDATE` on the existing row. Blocks until any concurrent
   * transaction holding it commits or rolls back — this is what serializes
   * two same-key requests. Returns null if the row no longer exists (holder
   * rolled back).
   */
  private async lockExisting(
    tx: Prisma.TransactionClient,
    params: BeginParams,
  ): Promise<ExistingRecordRow | null> {
    const rows = await tx.$queryRaw<ExistingRecordRow[]>`
      SELECT id::text, request_hash, state::text, response_status, response_body
      FROM idempotency_records
      WHERE actor_user_id = ${params.actorUserId}::uuid
        AND route_key = ${params.routeKey}
        AND idempotency_key = ${params.idempotencyKey}
      FOR UPDATE
    `;

    return rows[0] ?? null;
  }

  private async reclaim(
    tx: Prisma.TransactionClient,
    recordId: string,
    requestHash: string,
  ): Promise<void> {
    await tx.idempotencyRecord.update({
      where: { id: recordId },
      data: { state: 'PROCESSING', requestHash, responseStatus: null, responseBody: Prisma.DbNull },
    });
  }
}
