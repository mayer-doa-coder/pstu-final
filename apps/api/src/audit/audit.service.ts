import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { requestContext } from '../common/request-context';
import type { AuditAction, AuditResourceType } from './audit-action.enum';

/** Safe metadata: identifiers, enums, counts, booleans — never secrets or free text. */
export type AuditMetadata = Record<string, string | number | boolean | null>;

export interface AuditEntry {
  actorUserId: string | null;
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId?: string | null;
  metadata?: AuditMetadata;
}

/**
 * Writes the `audit_events` trail. Two deliberately different guarantees:
 *
 *  - `record(tx, …)` joins the caller's transaction, so an audit row for a
 *    financial action commits atomically with the money movement it
 *    describes — the trail can never drift from the ledger.
 *  - `recordDetached(…)` is best-effort and never throws. Used for auth and
 *    security events, and for *failed* operations whose own transaction
 *    rolled back (an in-transaction row would have rolled back with it).
 *
 * `requestId` is read from the AsyncLocalStorage correlation context rather
 * than threaded through every call site, so an investigator can pivot from a
 * log line to the audit rows of the same request for free.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
    await tx.auditEvent.create({ data: this.toRow(entry) });
  }

  /**
   * Fire-and-forget audit. Swallows its own failure: an unwritable audit row
   * must never turn a successful login — or an already-failing request — into
   * a different error for the user.
   */
  async recordDetached(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditEvent.create({ data: this.toRow(entry) });
    } catch (error) {
      this.logger.error(`Failed to write audit event ${entry.action}: ${(error as Error).message}`);
    }
  }

  private toRow(entry: AuditEntry): Prisma.AuditEventUncheckedCreateInput {
    return {
      actorUserId: entry.actorUserId,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      requestId: requestContext.getStore() ?? null,
      metadata: (entry.metadata ?? {}) as Prisma.InputJsonValue,
    };
  }
}
