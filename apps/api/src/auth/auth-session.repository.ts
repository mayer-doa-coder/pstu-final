import { Injectable } from '@nestjs/common';
import type { AuthSession, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

type Db = PrismaService | Prisma.TransactionClient;

export interface CreateAuthSessionData {
  userId: string;
  refreshTokenHash: string;
  userAgent: string | undefined;
  expiresAt: Date;
}

/** Owns all `auth_sessions` table persistence. */
@Injectable()
export class AuthSessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: CreateAuthSessionData, db: Db = this.prisma): Promise<AuthSession> {
    return db.authSession.create({
      data: {
        userId: data.userId,
        refreshTokenHash: data.refreshTokenHash,
        userAgent: data.userAgent,
        expiresAt: data.expiresAt,
      },
    });
  }

  findByTokenHash(refreshTokenHash: string, db: Db = this.prisma): Promise<AuthSession | null> {
    return db.authSession.findUnique({ where: { refreshTokenHash } });
  }

  async revoke(id: string, db: Db = this.prisma): Promise<void> {
    await db.authSession.update({ where: { id }, data: { revokedAt: new Date() } });
  }

  async revokeAllActiveForUser(userId: string, db: Db = this.prisma): Promise<void> {
    await db.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}
