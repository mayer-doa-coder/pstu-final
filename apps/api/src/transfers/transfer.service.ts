import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditAction } from '../audit/audit-action.enum';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/exceptions/app.exception';
import { ErrorCode } from '../common/exceptions/error-code.enum';
import { PrismaService } from '../database/prisma.service';
import { isRetryableTransactionError } from '../database/prisma-errors.util';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { TransactionLimitService } from '../limits/transaction-limit.service';
import { OutboxRepository } from '../outbox/outbox.repository';
import { HIGH_VELOCITY_WINDOW_MINUTES, RiskEngineService } from '../risk/risk-engine.service';
import { RiskRepository } from '../risk/risk.repository';
import type { RiskAssessmentDto } from '../risk/dto/risk-assessment.dto';
import { type LockedWallet, TransfersRepository } from './transfers.repository';
import { toTransferDto } from './transfer.mapper';
import type { TransferDto } from './dto/transfer.dto';

/** Route identifier used as the idempotency uniqueness scope for this endpoint. */
const ROUTE_KEY = 'POST:/transfers';

/**
 * A transfer holds two wallet row locks, so the transaction should be short.
 * The timeout is generous enough to absorb queueing behind other transfers
 * on a hot wallet, but not so long that a stuck lock ties up a connection
 * indefinitely.
 */
const TRANSACTION_OPTIONS = { timeout: 15_000, maxWait: 15_000 } as const;

/** Deadlock/serialization victims are rolled back whole and retried unchanged. */
const MAX_TRANSFER_ATTEMPTS = 3;

export interface CreateDirectTransferCommand {
  actorUserId: string;
  receiverUserId: string;
  amountMinor: bigint;
  currency: 'BDT';
  note?: string;
  idempotencyKey: string;
}

/**
 * A transfer that settles an accepted money request. The caller
 * (MoneyRequestService.accept) already owns the DB transaction and resolves
 * idempotency at its own route, so this path performs the money movement
 * only — no transfer-level idempotency claim.
 */
export interface SettleMoneyRequestCommand {
  /** The payer — debited, i.e. the transfer sender. */
  payerUserId: string;
  /** The requester — credited, i.e. the transfer receiver. */
  requesterUserId: string;
  amountMinor: bigint;
  currency: 'BDT';
  note?: string;
  sourceRequestId: string;
}

/** What `settle` needs regardless of how the transfer was initiated. */
interface SettleInput {
  senderUserId: string;
  receiverUserId: string;
  amountMinor: bigint;
  currency: 'BDT';
  note?: string;
}

/** Where a transfer came from — threaded onto the row for linkage/audit. */
type TransferSource =
  { type: 'DIRECT'; requestId: null } | { type: 'MONEY_REQUEST'; requestId: string };

const DIRECT_SOURCE: TransferSource = { type: 'DIRECT', requestId: null };

/**
 * The single authoritative path for moving money between two wallets
 * (AGENT.md §3 hard rule). Controllers, and later the money-requests module,
 * call this — no one else debits or credits a wallet.
 *
 * The canonical 17-step direct-transfer sequence
 * (IMPLEMENTATION_GUIDE.md §1.4 / §3.6) lives in `runTransfer` below, top to
 * bottom, one DB transaction.
 */
@Injectable()
export class TransferService {
  private readonly logger = new Logger(TransferService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transfers: TransfersRepository,
    private readonly idempotency: IdempotencyService,
    private readonly outbox: OutboxRepository,
    private readonly audit: AuditService,
    private readonly riskEngine: RiskEngineService,
    private readonly riskRepository: RiskRepository,
    private readonly transactionLimits: TransactionLimitService,
  ) {}

  async createDirectTransfer(command: CreateDirectTransferCommand): Promise<TransferDto> {
    // Bounded retry for deadlock / serialization failures only. The
    // idempotency key is unchanged across attempts, so a retry that follows
    // a rolled-back attempt re-claims the key cleanly and cannot double-spend
    // (IMPLEMENTATION_GUIDE.md §1.5).
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.prisma.$transaction(
          (tx) => this.runTransfer(tx, command),
          TRANSACTION_OPTIONS,
        );
      } catch (error) {
        if (attempt < MAX_TRANSFER_ATTEMPTS && isRetryableTransactionError(error)) {
          this.logger.warn(`Transfer attempt ${attempt} hit a write conflict; retrying.`);
          continue;
        }
        // Audited outside any transaction: the one that failed has already
        // rolled back, so an in-transaction audit row would have vanished
        // with it — and a rejected transfer is exactly what an investigator
        // needs to see. Detached, so auditing can never mask the real error.
        await this.audit.recordDetached({
          actorUserId: command.actorUserId,
          action: AuditAction.TRANSFER_FAILED,
          resourceType: 'transfer',
          metadata: {
            receiverUserId: command.receiverUserId,
            amountMinor: command.amountMinor.toString(),
            currency: command.currency,
            reason: error instanceof AppException ? error.code : 'INTERNAL_ERROR',
          },
        });
        throw error;
      }
    }
  }

  /**
   * Move money for an accepted money request, inside the caller's
   * transaction. This is the ONLY entry point the money-requests module uses
   * to touch balances — it runs the identical debit/credit/ledger/outbox
   * sequence as a direct transfer, just without the transfer-level
   * idempotency claim (the caller owns that at its own route).
   */
  settleMoneyRequest(
    tx: Prisma.TransactionClient,
    command: SettleMoneyRequestCommand,
  ): Promise<TransferDto> {
    return this.settle(
      tx,
      {
        senderUserId: command.payerUserId,
        receiverUserId: command.requesterUserId,
        amountMinor: command.amountMinor,
        currency: command.currency,
        note: command.note,
      },
      { type: 'MONEY_REQUEST', requestId: command.sourceRequestId },
    );
  }

  private async runTransfer(
    tx: Prisma.TransactionClient,
    command: CreateDirectTransferCommand,
  ): Promise<TransferDto> {
    // (1) Durable idempotency: claim the key or replay the prior result.
    // Runs inside this transaction so claim + money movement + stored
    // response commit or roll back as one unit.
    const begin = await this.idempotency.begin(tx, {
      actorUserId: command.actorUserId,
      routeKey: ROUTE_KEY,
      idempotencyKey: command.idempotencyKey,
      payload: this.canonicalPayload(command),
    });
    if (begin.replayed) {
      return begin.responseBody as TransferDto;
    }

    const receipt = await this.settle(
      tx,
      {
        senderUserId: command.actorUserId,
        receiverUserId: command.receiverUserId,
        amountMinor: command.amountMinor,
        currency: command.currency,
        note: command.note,
      },
      DIRECT_SOURCE,
    );

    // (10) Persist the canonical response, then commit. A later retry with
    // the same key replays exactly this body.
    await this.idempotency.complete(tx, {
      recordId: begin.recordId,
      responseStatus: HttpStatus.CREATED,
      responseBody: receipt,
      resourceType: 'transfer',
      resourceId: receipt.transferId,
    });

    return receipt;
  }

  /**
   * Steps 2–9 of the canonical transfer sequence: the actual money movement.
   * Shared verbatim by direct transfers and money-request settlement so
   * debit/credit logic exists in exactly one place (AGENT.md §3).
   */
  private async settle(
    tx: Prisma.TransactionClient,
    input: SettleInput,
    source: TransferSource,
  ): Promise<TransferDto> {
    // (2) Reject a self-transfer before touching wallets: locking one row
    // twice would be meaningless and the DB CHECK forbids the row anyway.
    if (input.receiverUserId === input.senderUserId) {
      throw new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ErrorCode.INVALID_TRANSFER,
        'You cannot transfer money to yourself.',
      );
    }

    // (3) Resolve both wallets to learn their ids (needed for lock ordering).
    const senderProbe = await this.transfers.findWalletByUserId(tx, input.senderUserId);
    const receiverProbe = await this.transfers.findWalletByUserId(tx, input.receiverUserId);

    if (!senderProbe) {
      // The authenticated caller always has a wallet (created at registration).
      throw new AppException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        ErrorCode.INTERNAL_ERROR,
        'Sender wallet not found.',
      );
    }
    if (!receiverProbe) {
      // Don't distinguish "no such user" from "user has no wallet" to callers.
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.USER_NOT_FOUND,
        'Recipient not found.',
      );
    }

    // (4) Acquire both wallet row locks in ascending id order — the same
    // order for every transfer, so concurrent transfers queue instead of
    // deadlocking. `lockWalletById` re-reads balance/status *after* taking
    // the lock, so both snapshots reflect the current committed state.
    const [firstId, secondId] = [senderProbe.id, receiverProbe.id].sort();
    const first = await this.transfers.lockWalletById(tx, firstId);
    const second = await this.transfers.lockWalletById(tx, secondId);
    const sender = first.id === senderProbe.id ? first : second;
    const receiver = first.id === receiverProbe.id ? first : second;

    // (5) Revalidate everything against the locked, current state — balance
    // and account/wallet status can have changed since any earlier screen.
    this.assertParticipantsActive(sender, receiver);
    this.assertWalletsSpendable(sender, receiver);
    this.assertAmountAndBalance(input.amountMinor, sender);

    // (5b) Re-check the sender's rolling daily/weekly/monthly send limits
    // under the same lock, for the same reason the balance is re-checked
    // here rather than only on an earlier screen: usage can change between
    // when a client saw it and when this transaction runs. Applies to a
    // money-request accept too — the payer is still the one sending money.
    await this.transactionLimits.assertWithinLimits(tx, sender.userId, input.amountMinor);

    // (6) Create the PENDING transfer row.
    const transfer = await this.transfers.insertPendingTransfer(tx, {
      senderUserId: sender.userId,
      receiverUserId: receiver.userId,
      senderWalletId: sender.id,
      receiverWalletId: receiver.id,
      amountMinor: input.amountMinor,
      currency: input.currency,
      note: input.note ?? null,
      sourceType: source.type,
      sourceRequestId: source.requestId,
    });

    // (7) Append the balanced, immutable ledger pair and move the balances.
    // DEBIT = -amount, CREDIT = +amount => SUM(signed_amount_minor) = 0.
    const senderBalanceAfter = sender.balanceMinor - input.amountMinor;
    const receiverBalanceAfter = receiver.balanceMinor + input.amountMinor;

    await this.transfers.insertLedgerEntry(tx, {
      transferId: transfer.id,
      walletId: sender.id,
      direction: 'DEBIT',
      amountMinor: input.amountMinor,
      signedAmountMinor: -input.amountMinor,
      currency: input.currency,
      balanceAfterMinor: senderBalanceAfter,
    });
    await this.transfers.insertLedgerEntry(tx, {
      transferId: transfer.id,
      walletId: receiver.id,
      direction: 'CREDIT',
      amountMinor: input.amountMinor,
      signedAmountMinor: input.amountMinor,
      currency: input.currency,
      balanceAfterMinor: receiverBalanceAfter,
    });

    await this.transfers.applyBalanceDelta(tx, sender.id, -input.amountMinor);
    await this.transfers.applyBalanceDelta(tx, receiver.id, input.amountMinor);

    // (8) Flip PENDING -> SUCCEEDED (terminal).
    const settled = await this.transfers.markSucceeded(tx, transfer.id);

    // (8b) Score the transfer with the deterministic risk engine and record
    // the decision — every transfer gets an assessment row, not just the
    // flagged ones, so the audit trail can show what a LOW score looked like
    // too. This never blocks or fails the transfer (AGENT.md: detection, not
    // prevention); it only annotates a transfer that has already committed.
    const riskAssessment = await this.assessRisk(
      tx,
      transfer.id,
      sender,
      receiver,
      input.amountMinor,
    );

    // (9) Outbox event, same transaction — notifications/analytics are
    // produced later by the worker and never gate this commit.
    await this.outbox.insert(tx, {
      aggregateType: 'transfer',
      aggregateId: transfer.id,
      eventType: 'transfer.succeeded',
      payload: {
        transferId: transfer.id,
        senderUserId: sender.userId,
        receiverUserId: receiver.userId,
        amountMinor: input.amountMinor.toString(),
        currency: input.currency,
        sourceRequestId: source.requestId,
      },
    });

    // Audited inside the money transaction so the trail can never disagree
    // with the ledger — both commit or neither does. Identifiers and amount
    // only: the user's free-text note is never audited.
    await this.audit.record(tx, {
      actorUserId: sender.userId,
      action: AuditAction.TRANSFER_SUCCEEDED,
      resourceType: 'transfer',
      resourceId: transfer.id,
      metadata: {
        receiverUserId: receiver.userId,
        amountMinor: input.amountMinor.toString(),
        currency: input.currency,
        sourceType: source.type,
        sourceRequestId: source.requestId,
      },
    });

    return toTransferDto(settled, senderBalanceAfter, riskAssessment);
  }

  /**
   * Runs the deterministic risk rules and persists the result. A MEDIUM or
   * HIGH score is also audited as its own event (a LOW score is still
   * recorded on the transfer, just not separately audited — routine, not
   * noteworthy). Only HIGH gets an outbox event, since that is the only tier
   * with a follow-up action (the optional plain-language explanation).
   */
  private async assessRisk(
    tx: Prisma.TransactionClient,
    transferId: string,
    sender: LockedWallet,
    receiver: LockedWallet,
    amountMinor: bigint,
  ): Promise<RiskAssessmentDto> {
    const now = new Date();
    const sinceDate = new Date(now.getTime() - HIGH_VELOCITY_WINDOW_MINUTES * 60_000);
    const senderRecentTransferCount = await this.riskRepository.countRecentTransfersFromSender(
      tx,
      sender.userId,
      sinceDate,
    );

    const { score, level, reasons } = this.riskEngine.evaluate({
      amountMinor,
      senderBalanceBeforeMinor: sender.balanceMinor,
      senderCreatedAt: sender.ownerCreatedAt,
      receiverCreatedAt: receiver.ownerCreatedAt,
      senderVerificationStatus: sender.ownerVerificationStatus,
      senderRecentTransferCount,
      now,
    });

    await this.riskRepository.insertAssessment(tx, { transferId, score, level, reasons });

    if (level !== 'LOW') {
      await this.audit.record(tx, {
        actorUserId: sender.userId,
        action: AuditAction.TRANSFER_RISK_FLAGGED,
        resourceType: 'transfer',
        resourceId: transferId,
        metadata: { score, level, reasons: reasons.join(' | ') },
      });
    }

    if (level === 'HIGH') {
      await this.outbox.insert(tx, {
        aggregateType: 'transfer',
        aggregateId: transferId,
        eventType: 'transfer.risk_flagged',
        payload: { score, level, reasons },
      });
    }

    return { score, level, reasons, explanation: null };
  }

  /** The payload whose hash detects "same key, different request" reuse. */
  private canonicalPayload(command: CreateDirectTransferCommand): Record<string, unknown> {
    return {
      receiverUserId: command.receiverUserId,
      amountMinor: command.amountMinor.toString(),
      currency: command.currency,
      note: command.note ?? null,
    };
  }

  private assertParticipantsActive(sender: LockedWallet, receiver: LockedWallet): void {
    if (sender.ownerStatus !== 'ACTIVE') {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.FORBIDDEN,
        'Your account cannot send money right now.',
      );
    }
    if (receiver.ownerStatus !== 'ACTIVE') {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.USER_NOT_FOUND,
        'Recipient not found.',
      );
    }
  }

  private assertWalletsSpendable(sender: LockedWallet, receiver: LockedWallet): void {
    if (sender.status !== 'ACTIVE') {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.WALLET_UNAVAILABLE,
        'Your wallet is not active.',
      );
    }
    if (receiver.status !== 'ACTIVE') {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.WALLET_UNAVAILABLE,
        "The recipient's wallet cannot receive money right now.",
      );
    }
  }

  private assertAmountAndBalance(amountMinor: bigint, sender: LockedWallet): void {
    // Defense in depth: the request schema already rejects non-positive
    // amounts, but the domain re-asserts it inside the lock (step 8 of the
    // guide's algorithm).
    if (amountMinor <= 0n) {
      throw new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ErrorCode.INVALID_TRANSFER,
        'Transfer amount must be positive.',
      );
    }
    if (sender.balanceMinor < amountMinor) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.INSUFFICIENT_BALANCE,
        'Insufficient balance for this transfer.',
      );
    }
  }
}
