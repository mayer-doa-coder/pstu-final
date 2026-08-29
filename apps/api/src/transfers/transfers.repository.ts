import { Injectable } from '@nestjs/common';
import {
  type LedgerDirection,
  Prisma,
  type Transfer,
  type TransferSourceType,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

/**
 * Wallet row as seen inside a transfer transaction, joined with just enough
 * of its owner to re-check account status under the lock.
 */
export interface LockedWallet {
  id: string;
  userId: string;
  balanceMinor: bigint;
  status: 'ACTIVE' | 'FROZEN' | 'CLOSED';
  currency: string;
  ownerStatus: 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
}

export interface InsertTransferData {
  senderUserId: string;
  receiverUserId: string;
  senderWalletId: string;
  receiverWalletId: string;
  amountMinor: bigint;
  currency: string;
  note: string | null;
  // DIRECT for a peer-to-peer send; MONEY_REQUEST (with sourceRequestId set)
  // when the transfer settles an accepted money request.
  sourceType: TransferSourceType;
  sourceRequestId: string | null;
}

export interface LedgerEntryData {
  transferId: string;
  walletId: string;
  direction: LedgerDirection;
  amountMinor: bigint;
  signedAmountMinor: bigint;
  currency: string;
  balanceAfterMinor: bigint;
}

interface WalletJoinRow {
  id: string;
  user_id: string;
  balance_minor: bigint;
  wallet_status: LockedWallet['status'];
  currency: string;
  owner_status: LockedWallet['ownerStatus'];
}

/**
 * All `transfers` / `ledger_entries` / wallet-balance persistence for the
 * transfer domain. Every write method takes a `Prisma.TransactionClient`
 * with no default — nothing here is callable outside the transfer
 * transaction, which keeps balance mutation centralized (Risk 5).
 *
 * There is deliberately no generic "set balance" method: `applyBalanceDelta`
 * only moves a wallet by a ledgered amount, and only the service calls it,
 * once per side, immediately after writing the matching ledger row.
 */
@Injectable()
export class TransfersRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve a user's wallet before locking, to discover its id (needed to
   * compute the deterministic lock order). Returns null when the user has no
   * wallet — i.e. the user does not exist / is not a valid counterparty.
   */
  async findWalletByUserId(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<LockedWallet | null> {
    const rows = await tx.$queryRaw<WalletJoinRow[]>`
      SELECT w.id, w.user_id, w.balance_minor, w.status AS wallet_status,
             w.currency, u.status AS owner_status
      FROM wallets w
      JOIN users u ON u.id = w.user_id
      WHERE w.user_id = ${userId}::uuid
    `;
    return rows[0] ? this.toLockedWallet(rows[0]) : null;
  }

  /**
   * Take a `SELECT ... FOR UPDATE` row lock on one wallet. Callers MUST
   * invoke this in ascending wallet-id order (lower id first) so every
   * transfer path acquires locks in the same global order and cannot
   * deadlock against another (IMPLEMENTATION_GUIDE.md §1.5).
   *
   * A second query re-reads the fully-joined row *after* the lock is held,
   * so the balance and status we validate are the current committed values,
   * not what we saw before waiting on the lock.
   */
  async lockWalletById(tx: Prisma.TransactionClient, walletId: string): Promise<LockedWallet> {
    await tx.$queryRaw`SELECT id FROM wallets WHERE id = ${walletId}::uuid FOR UPDATE`;

    const rows = await tx.$queryRaw<WalletJoinRow[]>`
      SELECT w.id, w.user_id, w.balance_minor, w.status AS wallet_status,
             w.currency, u.status AS owner_status
      FROM wallets w
      JOIN users u ON u.id = w.user_id
      WHERE w.id = ${walletId}::uuid
    `;

    // The wallet existed a moment ago (we resolved it by user id) and wallets
    // are never deleted, so a missing row here is a real invariant breach.
    const row = rows[0];
    if (!row) {
      throw new Error(`Wallet ${walletId} disappeared while locking`);
    }
    return this.toLockedWallet(row);
  }

  insertPendingTransfer(tx: Prisma.TransactionClient, data: InsertTransferData): Promise<Transfer> {
    return tx.transfer.create({
      data: {
        senderUserId: data.senderUserId,
        receiverUserId: data.receiverUserId,
        senderWalletId: data.senderWalletId,
        receiverWalletId: data.receiverWalletId,
        amountMinor: data.amountMinor,
        currency: data.currency,
        note: data.note,
        status: 'PENDING',
        sourceType: data.sourceType,
        sourceRequestId: data.sourceRequestId,
      },
    });
  }

  /** Append one immutable ledger row. Never updated or deleted afterwards. */
  insertLedgerEntry(tx: Prisma.TransactionClient, entry: LedgerEntryData): Promise<{ id: string }> {
    return tx.ledgerEntry.create({
      data: {
        transferId: entry.transferId,
        walletId: entry.walletId,
        direction: entry.direction,
        amountMinor: entry.amountMinor,
        signedAmountMinor: entry.signedAmountMinor,
        currency: entry.currency,
        balanceAfterMinor: entry.balanceAfterMinor,
      },
      select: { id: true },
    });
  }

  /**
   * Move a wallet balance by `deltaMinor` (negative to debit, positive to
   * credit). Safe as a blind delta because the caller already holds this
   * wallet's `FOR UPDATE` lock and has re-checked sufficiency; the
   * `balance_minor >= 0` CHECK constraint is the last-line guard if that
   * logic is ever wrong.
   */
  async applyBalanceDelta(
    tx: Prisma.TransactionClient,
    walletId: string,
    deltaMinor: bigint,
  ): Promise<void> {
    await tx.$executeRaw`
      UPDATE wallets
      SET balance_minor = balance_minor + ${deltaMinor}, updated_at = now()
      WHERE id = ${walletId}::uuid
    `;
  }

  markSucceeded(tx: Prisma.TransactionClient, transferId: string): Promise<Transfer> {
    return tx.transfer.update({
      where: { id: transferId },
      data: { status: 'SUCCEEDED', completedAt: new Date() },
    });
  }

  /** Read path for `GET /transfers/:id` — no transaction, no lock. */
  findById(transferId: string): Promise<Transfer | null> {
    return this.prisma.transfer.findUnique({ where: { id: transferId } });
  }

  private toLockedWallet(row: WalletJoinRow): LockedWallet {
    return {
      id: row.id,
      userId: row.user_id,
      balanceMinor: BigInt(row.balance_minor),
      status: row.wallet_status,
      currency: row.currency.trim(),
      ownerStatus: row.owner_status,
    };
  }
}
