import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AccountStatusService } from './account-status.service';

/**
 * Global: JwtAuthGuard is applied by controllers across every domain module,
 * so its dependencies must resolve everywhere. Making this global means a new
 * module can use the guard without knowing what the guard happens to inject.
 */
@Global()
@Module({
  imports: [DatabaseModule],
  providers: [AccountStatusService],
  exports: [AccountStatusService],
})
export class SecurityModule {}
