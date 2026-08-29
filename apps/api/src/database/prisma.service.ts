import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Thin lifecycle wrapper around PrismaClient. PostgreSQL is the single
 * source of truth for all financial state (IMPLEMENTATION_GUIDE.md §1.1) —
 * every domain module depends on this service rather than instantiating its
 * own client.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Connected to PostgreSQL.');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
