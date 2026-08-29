import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuditService } from './audit.service';

/**
 * Global: auditing is cross-cutting — auth, transfers, money requests, and
 * the auth guard all write to it. Making it global avoids threading an
 * AuditModule import through every domain module for one stateless service.
 */
@Global()
@Module({
  imports: [DatabaseModule],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
