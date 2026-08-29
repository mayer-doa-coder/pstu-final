import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppException } from '../common/exceptions/app.exception';
import { ErrorCode } from '../common/exceptions/error-code.enum';
import { PrismaService } from '../database/prisma.service';
import { isRetryableTransactionError } from '../database/prisma-errors.util';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { OutboxRepository } from '../outbox/outbox.repository';
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
        throw error;
      }
    }
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

    // (2) Reject a self-transfer before touching wallets: locking one row
    // twice would be meaningless and the DB CHECK forbids the row anyway.
    if (command.receiverUserId === command.actorUserId) {
      throw new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ErrorCode.INVALID_TRANSFER,
        'You cannot transfer money to yourself.',
      );
    }

    // (3) Resolve both wallets to learn their ids (needed for lock ordering).
    const senderProbe = await this.transfers.findWalletByUserId(tx, command.actorUserId);
    const receiverProbe = await this.transfers.findWalletByUserId(tx, command.receiverUserId);

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
    this.assertAmountAndBalance(command.amountMinor, sender);

    // (6) Create the PENDING transfer row.
    const transfer = await this.transfers.insertPendingTransfer(tx, {
      senderUserId: sender.userId,
      receiverUserId: receiver.userId,
      senderWalletId: sender.id,
      receiverWalletId: receiver.id,
      amountMinor: command.amountMinor,
      currency: command.currency,
      note: command.note ?? null,
    });

    // (7) Append the balanced, immutable ledger pair and move the balances.
    // DEBIT = -amount, CREDIT = +amount => SUM(signed_amount_minor) = 0.
    const senderBalanceAfter = sender.balanceMinor - command.amountMinor;
    const receiverBalanceAfter = receiver.balanceMinor + command.amountMinor;

    await this.transfers.insertLedgerEntry(tx, {
      transferId: transfer.id,
      walletId: sender.id,
      direction: 'DEBIT',
      amountMinor: command.amountMinor,
      signedAmountMinor: -command.amountMinor,
      currency: command.currency,
      balanceAfterMinor: senderBalanceAfter,
    });
    await this.transfers.insertLedgerEntry(tx, {
      transferId: transfer.id,
      walletId: receiver.id,
      direction: 'CREDIT',
      amountMinor: command.amountMinor,
      signedAmountMinor: command.amountMinor,
      currency: command.currency,
      balanceAfterMinor: receiverBalanceAfter,
    });

    await this.transfers.applyBalanceDelta(tx, sender.id, -command.amountMinor);
    await this.transfers.applyBalanceDelta(tx, receiver.id, command.amountMinor);

    // (8) Flip PENDING -> SUCCEEDED (terminal).
    const settled = await this.transfers.markSucceeded(tx, transfer.id);

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
        amountMinor: command.amountMinor.toString(),
        currency: command.currency,
      },
    });

    // (10) Persist the canonical response, then commit. A later retry with
    // the same key replays exactly this body.
    const receipt = toTransferDto(settled, senderBalanceAfter);
    await this.idempotency.complete(tx, {
      recordId: begin.recordId,
      responseStatus: HttpStatus.CREATED,
      responseBody: receipt,
      resourceType: 'transfer',
      resourceId: transfer.id,
    });

    return receipt;
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
