import { Injectable } from '@nestjs/common';
import type { Prisma, Wallet } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

type Db = PrismaService | Prisma.TransactionClient;

export interface CreateWalletData {
  userId: string;
  balanceMinor: bigint;
}

/**
 * Owns all `wallets` table persistence. `create` requires an explicit
 * Prisma client/transaction argument (no default) — a wallet must only ever
 * be created as part of the atomic user+wallet registration transaction.
 * No other write method exists here on purpose: balance mutation belongs to
 * the `transfers` module once it lands (IMPLEMENTATION_GUIDE.md §1.3).
 */
@Injectable()
export class WalletsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByUserId(userId: string, db: Db = this.prisma): Promise<Wallet | null> {
    return db.wallet.findUnique({ where: { userId } });
  }

  create(data: CreateWalletData, db: Db): Promise<Wallet> {
    return db.wallet.create({ data: { userId: data.userId, balanceMinor: data.balanceMinor, currency: 'BDT' } });
  }
}
