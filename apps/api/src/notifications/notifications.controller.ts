import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CsrfGuard } from '../common/guards/csrf.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CursorPage } from '../common/pagination/cursor-page';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import {
  listNotificationsQuerySchema,
  type ListNotificationsQuery,
} from './dto/list-notifications.schema';
import type { NotificationDto } from './dto/notification.dto';
import { NotificationsService } from './notifications.service';

@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(listNotificationsQuerySchema)) query: ListNotificationsQuery,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CursorPage<NotificationDto>> {
    return this.notifications.listForUser(user.id, query);
  }

  // No Idempotency-Key: this moves no money and is naturally idempotent
  // (marking an already-read notification read is a no-op).
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.OK)
  @Post(':id/read')
  markRead(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<NotificationDto> {
    return this.notifications.markRead(id, user.id);
  }
}
