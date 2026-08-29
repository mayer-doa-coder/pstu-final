import { Injectable } from '@nestjs/common';
import type { Prisma, User } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

type Db = PrismaService | Prisma.TransactionClient;

export interface CreateUserData {
  email: string;
  displayName: string;
  passwordHash: string;
}

export interface SearchUsersCriteria {
  query: string;
  excludeUserId: string;
  cursorId?: string;
  /** Fetch this many rows; callers typically pass `pageSize + 1` to detect a next page without a separate count query. */
  take: number;
}

export type UserSearchRow = Pick<User, 'id' | 'displayName' | 'email'>;

/**
 * Owns all `users` table persistence. `create` requires an explicit
 * Prisma client/transaction argument (no default) so registration can only
 * ever create a user as part of the atomic user+wallet transaction — never
 * as a standalone write.
 */
@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string, db: Db = this.prisma): Promise<User | null> {
    return db.user.findUnique({ where: { email } });
  }

  findById(id: string, db: Db = this.prisma): Promise<User | null> {
    return db.user.findUnique({ where: { id } });
  }

  create(data: CreateUserData, db: Db): Promise<User> {
    return db.user.create({ data });
  }

  /**
   * Recipient discovery for send/request money (PRD.md §4.3). An `@`
   * in the query is treated as an exact, case-insensitive email lookup
   * (the `email` column is CITEXT) rather than a partial match — per
   * IMPLEMENTATION_GUIDE.md Risk 10, contact identifiers prefer
   * exact-match to limit how much a search can fish for by substring.
   * Display names support partial (substring) matching, which is the
   * expected UX for "find someone by name."
   */
  search(criteria: SearchUsersCriteria, db: Db = this.prisma): Promise<UserSearchRow[]> {
    const isEmailQuery = criteria.query.includes('@');

    return db.user.findMany({
      where: {
        id: { not: criteria.excludeUserId },
        status: 'ACTIVE',
        ...(isEmailQuery
          ? { email: criteria.query.toLowerCase() }
          : { displayName: { contains: criteria.query, mode: 'insensitive' } }),
      },
      select: { id: true, displayName: true, email: true },
      orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
      take: criteria.take,
      ...(criteria.cursorId ? { cursor: { id: criteria.cursorId }, skip: 1 } : {}),
    });
  }
}
