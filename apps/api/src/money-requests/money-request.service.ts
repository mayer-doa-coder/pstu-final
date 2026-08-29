import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { type MoneyRequest, Prisma } from '@prisma/client';
import { AuditAction } from '../audit/audit-action.enum';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/exceptions/app.exception';
import { ErrorCode } from '../common/exceptions/error-code.enum';
import { PrismaService } from '../database/prisma.service';
import { isRetryableTransactionError } from '../database/prisma-errors.util';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { OutboxRepository } from '../outbox/outbox.repository';
import { TransferService } from '../transfers/transfer.service';
import { UsersRepository } from '../users/users.repository';
import { toMoneyRequestDto } from './money-request.mapper';
import { type ParticipantRole, MoneyRequestsRepository } from './money-requests.repository';
import type { MoneyRequestDto } from './dto/money-request.dto';

const CREATE_ROUTE = 'POST:/money-requests';
const ACCEPT_ROUTE = 'POST:/money-requests/accept';
const DECLINE_ROUTE = 'POST:/money-requests/decline';
const CANCEL_ROUTE = 'POST:/money-requests/cancel';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Accept holds the request row plus two wallet locks — keep the txn short. */
const TRANSACTION_OPTIONS = { timeout: 15_000, maxWait: 15_000 } as const;

/** Deadlock / serialization victims roll back whole and retry unchanged. */
const MAX_ACCEPT_ATTEMPTS = 3;

export interface CreateMoneyRequestCommand {
  actorUserId: string;
  payerUserId: string;
  amountMinor: bigint;
  currency: 'BDT';
  note?: string;
  expiresAt: Date | null;
  idempotencyKey: string;
}

export interface ResolveMoneyRequestCommand {
  actorUserId: string;
  requestId: string;
  idempotencyKey: string;
}

/**
 * Request lifecycle: create / accept / decline / cancel
 * (IMPLEMENTATION_GUIDE.md §3.9–§3.14).
 *
 * Hard rules this service obeys:
 *  - Creating a request moves NO money and never touches a wallet.
 *  - `accept` is the only path that moves money, and it delegates every
 *    debit/credit to `TransferService` inside the same transaction — it does
 *    not reimplement balance logic (AGENT.md §3, Risk 5).
 *  - Every transition locks the request row `FOR UPDATE` and re-checks the
 *    pre-state is still `PENDING`, so terminal states never transition again
 *    and concurrent callers produce exactly one outcome (AC-4).
 */
@Injectable()
export class MoneyRequestService {
  private readonly logger = new Logger(MoneyRequestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: MoneyRequestsRepository,
    private readonly idempotency: IdempotencyService,
    private readonly outbox: OutboxRepository,
    private readonly transfers: TransferService,
    private readonly users: UsersRepository,
    private readonly audit: AuditService,
  ) {}

  async create(command: CreateMoneyRequestCommand): Promise<MoneyRequestDto> {
    if (command.payerUserId === command.actorUserId) {
      throw new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ErrorCode.VALIDATION_ERROR,
        'You cannot request money from yourself.',
      );
    }
    if (command.expiresAt && command.expiresAt.getTime() <= Date.now()) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        'expiresAt must be in the future.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Durable idempotency in the same transaction as the insert: a retry
      // with the same key + body replays the original request rather than
      // creating a second one.
      const begin = await this.idempotency.begin(tx, {
        actorUserId: command.actorUserId,
        routeKey: CREATE_ROUTE,
        idempotencyKey: command.idempotencyKey,
        payload: this.createPayload(command),
      });
      if (begin.replayed) {
        return begin.responseBody as MoneyRequestDto;
      }

      const payer = await this.users.findById(command.payerUserId, tx);
      if (!payer || payer.status !== 'ACTIVE') {
        // Don't distinguish "no such user" from "inactive user" to callers.
        throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.USER_NOT_FOUND, 'Payer not found.');
      }

      const row = await this.repo.create(tx, {
        requesterUserId: command.actorUserId,
        payerUserId: command.payerUserId,
        amountMinor: command.amountMinor,
        currency: command.currency,
        note: command.note ?? null,
        expiresAt: command.expiresAt,
      });

      await this.outbox.insert(tx, {
        aggregateType: 'money_request',
        aggregateId: row.id,
        eventType: 'money_request.created',
        payload: this.eventPayload(row),
      });
      await this.audit.record(tx, {
        actorUserId: command.actorUserId,
        action: AuditAction.MONEY_REQUEST_CREATED,
        resourceType: 'money_request',
        resourceId: row.id,
        metadata: {
          payerUserId: row.payerUserId,
          amountMinor: row.amountMinor.toString(),
          currency: row.currency.trim(),
        },
      });

      const dto = toMoneyRequestDto(row);
      await this.idempotency.complete(tx, {
        recordId: begin.recordId,
        responseStatus: HttpStatus.CREATED,
        responseBody: dto,
        resourceType: 'money_request',
        resourceId: row.id,
      });
      return dto;
    });
  }

  async accept(command: ResolveMoneyRequestCommand): Promise<MoneyRequestDto> {
    this.assertRequestId(command.requestId);

    // Bounded retry for write-conflict rollbacks only; the idempotency key is
    // unchanged across attempts, so a retry can't double-settle.
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.prisma.$transaction(
          (tx) => this.runAccept(tx, command),
          TRANSACTION_OPTIONS,
        );
      } catch (error) {
        if (attempt < MAX_ACCEPT_ATTEMPTS && isRetryableTransactionError(error)) {
          this.logger.warn(`Accept attempt ${attempt} hit a write conflict; retrying.`);
          continue;
        }
        throw error;
      }
    }
  }

  decline(command: ResolveMoneyRequestCommand): Promise<MoneyRequestDto> {
    return this.resolvePending(command, {
      routeKey: DECLINE_ROUTE,
      requiredRole: 'payer',
      target: 'DECLINED',
    });
  }

  cancel(command: ResolveMoneyRequestCommand): Promise<MoneyRequestDto> {
    return this.resolvePending(command, {
      routeKey: CANCEL_ROUTE,
      requiredRole: 'requester',
      target: 'CANCELLED',
    });
  }

  private async runAccept(
    tx: Prisma.TransactionClient,
    command: ResolveMoneyRequestCommand,
  ): Promise<MoneyRequestDto> {
    // (1) Durable idempotency — claim the key or replay the prior acceptance.
    const begin = await this.idempotency.begin(tx, {
      actorUserId: command.actorUserId,
      routeKey: ACCEPT_ROUTE,
      idempotencyKey: command.idempotencyKey,
      payload: { requestId: command.requestId },
    });
    if (begin.replayed) {
      return begin.responseBody as MoneyRequestDto;
    }

    // (2) Lock the request row. This is the serialization point: any other
    // accept/decline/cancel on this request now blocks until we commit or
    // roll back, so at most one of them settles it.
    const request = await this.repo.lockById(tx, command.requestId);
    if (!request) {
      throw this.notFound();
    }

    // (3) Only the designated payer may accept.
    this.assertActorRole(request, command.actorUserId, 'payer');

    // (4) Pre-state must still be PENDING — terminal states never re-transition.
    if (request.status !== 'PENDING') {
      throw this.alreadyResolved('This money request has already been resolved.');
    }

    // (5) Reject an expired request. No sweeper runs yet, so the check is on
    // elapsed wall-clock time, not the stored status.
    if (request.expiresAt && request.expiresAt.getTime() <= Date.now()) {
      throw this.alreadyResolved('This money request has expired.');
    }

    // (6)–(9) Hand the entire money movement to the transfer domain, inside
    // this transaction. Exactly one linked transfer is created; the payer is
    // debited and the requester credited through the one authoritative path.
    const transfer = await this.transfers.settleMoneyRequest(tx, {
      payerUserId: request.payerUserId,
      requesterUserId: request.requesterUserId,
      amountMinor: request.amountMinor,
      currency: request.currency.trim() as 'BDT',
      note: request.note ?? undefined,
      sourceRequestId: request.id,
    });

    // (10)–(11) Flip PENDING -> ACCEPTED and link the settling transfer. The
    // row state change and the transfer commit atomically as one unit.
    const accepted = await this.repo.markAccepted(tx, request.id, transfer.transferId);

    await this.outbox.insert(tx, {
      aggregateType: 'money_request',
      aggregateId: request.id,
      eventType: 'money_request.accepted',
      payload: {
        ...this.eventPayload(request),
        acceptedTransferId: transfer.transferId,
      },
    });
    await this.audit.record(tx, {
      actorUserId: command.actorUserId,
      action: AuditAction.MONEY_REQUEST_ACCEPTED,
      resourceType: 'money_request',
      resourceId: request.id,
      metadata: {
        acceptedTransferId: transfer.transferId,
        requesterUserId: request.requesterUserId,
        amountMinor: request.amountMinor.toString(),
        currency: request.currency.trim(),
      },
    });

    // (12) Persist the canonical result; a later retry replays exactly this.
    const dto = toMoneyRequestDto(accepted);
    await this.idempotency.complete(tx, {
      recordId: begin.recordId,
      responseStatus: HttpStatus.OK,
      responseBody: dto,
      resourceType: 'money_request',
      resourceId: request.id,
    });
    return dto;
  }

  private resolvePending(
    command: ResolveMoneyRequestCommand,
    opts: { routeKey: string; requiredRole: ParticipantRole; target: 'DECLINED' | 'CANCELLED' },
  ): Promise<MoneyRequestDto> {
    this.assertRequestId(command.requestId);

    return this.prisma.$transaction(async (tx) => {
      const begin = await this.idempotency.begin(tx, {
        actorUserId: command.actorUserId,
        routeKey: opts.routeKey,
        idempotencyKey: command.idempotencyKey,
        payload: { requestId: command.requestId },
      });
      if (begin.replayed) {
        return begin.responseBody as MoneyRequestDto;
      }

      // Lock before reading the pre-state so a concurrent accept/decline/
      // cancel can't slip a transition in between our check and our write.
      const request = await this.repo.lockById(tx, command.requestId);
      if (!request) {
        throw this.notFound();
      }
      this.assertActorRole(request, command.actorUserId, opts.requiredRole);
      if (request.status !== 'PENDING') {
        throw this.alreadyResolved('This money request has already been resolved.');
      }

      const resolved = await this.repo.markResolved(tx, request.id, opts.target);

      await this.outbox.insert(tx, {
        aggregateType: 'money_request',
        aggregateId: request.id,
        eventType:
          opts.target === 'DECLINED' ? 'money_request.declined' : 'money_request.cancelled',
        payload: this.eventPayload(request),
      });
      await this.audit.record(tx, {
        actorUserId: command.actorUserId,
        action:
          opts.target === 'DECLINED'
            ? AuditAction.MONEY_REQUEST_DECLINED
            : AuditAction.MONEY_REQUEST_CANCELLED,
        resourceType: 'money_request',
        resourceId: request.id,
        metadata: {
          amountMinor: request.amountMinor.toString(),
          currency: request.currency.trim(),
        },
      });

      const dto = toMoneyRequestDto(resolved);
      await this.idempotency.complete(tx, {
        recordId: begin.recordId,
        responseStatus: HttpStatus.OK,
        responseBody: dto,
        resourceType: 'money_request',
        resourceId: request.id,
      });
      return dto;
    });
  }

  /**
   * Shared outbox payload for every money-request event. Amounts travel as
   * strings so JSONB round-trips them without float precision loss. Carries
   * identifiers and the amount only — never the user's free-text note.
   */
  private eventPayload(request: MoneyRequest): Prisma.JsonObject {
    return {
      requestId: request.id,
      payerUserId: request.payerUserId,
      requesterUserId: request.requesterUserId,
      amountMinor: request.amountMinor.toString(),
      currency: request.currency.trim(),
    };
  }

  private createPayload(command: CreateMoneyRequestCommand): Record<string, unknown> {
    return {
      payerUserId: command.payerUserId,
      amountMinor: command.amountMinor.toString(),
      currency: command.currency,
      note: command.note ?? null,
      expiresAt: command.expiresAt ? command.expiresAt.toISOString() : null,
    };
  }

  /**
   * Participant authorization. A non-participant gets `404` (no existence
   * leak, matching the transfer detail endpoint); a participant acting in the
   * wrong role gets `403`.
   */
  private assertActorRole(
    request: MoneyRequest,
    actorUserId: string,
    requiredRole: ParticipantRole,
  ): void {
    const isPayer = request.payerUserId === actorUserId;
    const isRequester = request.requesterUserId === actorUserId;
    if (!isPayer && !isRequester) {
      throw this.notFound();
    }
    const actualRole: ParticipantRole = isPayer ? 'payer' : 'requester';
    if (actualRole !== requiredRole) {
      const who = requiredRole === 'payer' ? 'the payer' : 'the requester';
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.FORBIDDEN,
        `Only ${who} can perform this action.`,
      );
    }
  }

  private assertRequestId(id: string): void {
    if (!UUID_PATTERN.test(id)) {
      throw this.notFound();
    }
  }

  private notFound(): AppException {
    return new AppException(
      HttpStatus.NOT_FOUND,
      ErrorCode.MONEY_REQUEST_NOT_FOUND,
      'Money request not found.',
    );
  }

  private alreadyResolved(message: string): AppException {
    return new AppException(HttpStatus.CONFLICT, ErrorCode.REQUEST_ALREADY_RESOLVED, message);
  }
}
