import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CursorPage } from '../common/pagination/cursor-page';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { ActivityQueryService } from './activity-query.service';
import type { ActivityItemDto } from './dto/activity-item.dto';
import { listActivityQuerySchema, type ListActivityQuery } from './dto/list-activity.schema';

@UseGuards(JwtAuthGuard)
@Controller('activity')
export class ActivityController {
  constructor(private readonly activity: ActivityQueryService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(listActivityQuerySchema)) query: ListActivityQuery,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CursorPage<ActivityItemDto>> {
    return this.activity.listForUser(user.id, query);
  }
}
