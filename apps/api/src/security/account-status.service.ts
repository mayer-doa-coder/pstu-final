import { Injectable } from '@nestjs/common';
import type { UserStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

/**
 * Resolves the *current* account status of an authenticated caller.
 *
 * Why a database read on every authenticated request: the access token is a
 * stateless JWT with a multi-minute lifetime, so a token minted before an
 * account was suspended or closed stays cryptographically valid. Without this
 * check, a suspended user could keep transacting until their token expired.
 * PostgreSQL is the authority on account status (IMPLEMENTATION_GUIDE.md
 * §1.1), so the check reads from it — not from a Redis cache that could serve
 * a stale "ACTIVE" during exactly the incident it exists to stop.
 *
 * The cost is one primary-key lookup per request, which is the right trade
 * for a money-movement API.
 */
@Injectable()
export class AccountStatusService {
  constructor(private readonly prisma: PrismaService) {}

  /** Returns null when the user no longer exists. */
  async findStatus(userId: string): Promise<UserStatus | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { status: true },
    });
    return user?.status ?? null;
  }
}
