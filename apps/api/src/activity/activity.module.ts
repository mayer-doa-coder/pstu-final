import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { UsersModule } from '../users/users.module';
import { ActivityQueryService } from './activity-query.service';
import { ActivityController } from './activity.controller';
import { ActivityRepository } from './activity.repository';

/**
 * Read-only activity & history (Milestone 5). A dedicated query model inside
 * the monolith — no writes, no CQRS infrastructure.
 */
@Module({
  imports: [DatabaseModule, UsersModule],
  controllers: [ActivityController],
  providers: [ActivityQueryService, ActivityRepository],
})
export class ActivityModule {}
