import {
  Body,
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
import { IdempotencyKey } from '../common/decorators/idempotency-key.decorator';
import { CsrfGuard } from '../common/guards/csrf.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CursorPage } from '../common/pagination/cursor-page';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { RateLimitGuard } from '../common/rate-limit/rate-limit.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import {
  createMoneyRequestSchema,
  type CreateMoneyRequestInput,
} from './dto/create-money-request.schema';
import {
  listMoneyRequestsQuerySchema,
  type ListMoneyRequestsQuery,
} from './dto/list-money-requests.schema';
import type { MoneyRequestDto } from './dto/money-request.dto';
import { MoneyRequestQueryService } from './money-request-query.service';
import { MoneyRequestService } from './money-request.service';

/**
 * HTTP surface for the money-request domain. The controller wires transport
 * concerns only — auth, CSRF, body/query validation, the idempotency *key* —
 * to the domain services. It owns no lifecycle or money logic (AGENT.md §3).
 */
// A money request lands in someone else's notification feed, so an unbounded
// create rate is a spam vector aimed at another user, not just load.
const CREATE_REQUEST_RATE_LIMIT = { limit: 20, windowSeconds: 60 };

@UseGuards(JwtAuthGuard)
@Controller('money-requests')
export class MoneyRequestsController {
  constructor(
    private readonly requests: MoneyRequestService,
    private readonly queries: MoneyRequestQueryService,
  ) {}

  @UseGuards(CsrfGuard, RateLimitGuard)
  @RateLimit(CREATE_REQUEST_RATE_LIMIT)
  @Post()
  create(
    @Body(new ZodValidationPipe(createMoneyRequestSchema)) body: CreateMoneyRequestInput,
    @IdempotencyKey() idempotencyKey: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MoneyRequestDto> {
    return this.requests.create({
      actorUserId: user.id,
      payerUserId: body.payerUserId,
      amountMinor: BigInt(body.amountMinor),
      currency: body.currency,
      note: body.note,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      idempotencyKey,
    });
  }

  @Get('incoming')
  listIncoming(
    @Query(new ZodValidationPipe(listMoneyRequestsQuerySchema)) query: ListMoneyRequestsQuery,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CursorPage<MoneyRequestDto>> {
    return this.queries.listIncoming(user.id, query);
  }

  @Get('outgoing')
  listOutgoing(
    @Query(new ZodValidationPipe(listMoneyRequestsQuerySchema)) query: ListMoneyRequestsQuery,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CursorPage<MoneyRequestDto>> {
    return this.queries.listOutgoing(user.id, query);
  }

  @Get(':id')
  getOne(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MoneyRequestDto> {
    return this.queries.getForParticipant(id, user.id);
  }

  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.OK)
  @Post(':id/accept')
  accept(
    @Param('id') id: string,
    @IdempotencyKey() idempotencyKey: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MoneyRequestDto> {
    return this.requests.accept({ actorUserId: user.id, requestId: id, idempotencyKey });
  }

  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.OK)
  @Post(':id/decline')
  decline(
    @Param('id') id: string,
    @IdempotencyKey() idempotencyKey: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MoneyRequestDto> {
    return this.requests.decline({ actorUserId: user.id, requestId: id, idempotencyKey });
  }

  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.OK)
  @Post(':id/cancel')
  cancel(
    @Param('id') id: string,
    @IdempotencyKey() idempotencyKey: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MoneyRequestDto> {
    return this.requests.cancel({ actorUserId: user.id, requestId: id, idempotencyKey });
  }
}
