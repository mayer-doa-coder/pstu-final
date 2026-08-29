import { Injectable } from '@nestjs/common';
import type { Prisma, User } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

type Db = PrismaService | Prisma.TransactionClient;

export interface CreateUserData {
  email: string;
  displayName: string;
  passwordHash: string;
}

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
}
