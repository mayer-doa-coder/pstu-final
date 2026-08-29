import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { IdempotencyKey } from '../common/decorators/idempotency-key.decorator';
import { CsrfGuard } from '../common/guards/csrf.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { RateLimitGuard } from '../common/rate-limit/rate-limit.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { createTransferSchema, type CreateTransferInput } from './dto/create-transfer.schema';
import type { TransferDto } from './dto/transfer.dto';
import { TransferService } from './transfer.service';
import { TransferQueryService } from './transfer-query.service';

/**
 * HTTP surface for the transfer domain. The controller only wires transport
 * concerns — auth, CSRF, body validation, the idempotency *key* — to the
 * domain service. It never touches balances, locks, ledger rows, or
 * idempotency business logic (AGENT.md §3).
 */
// A per-user ceiling on money movement. Idempotency already collapses honest
// double-submits, so this exists for the abusive case: a compromised session
// draining a wallet in a scripted burst. Well above any human send rate.
const CREATE_TRANSFER_RATE_LIMIT = { limit: 30, windowSeconds: 60 };

@UseGuards(JwtAuthGuard)
@Controller('transfers')
export class TransfersController {
  constructor(
    private readonly transferService: TransferService,
    private readonly transferQueryService: TransferQueryService,
  ) {}

  @UseGuards(CsrfGuard, RateLimitGuard)
  @RateLimit(CREATE_TRANSFER_RATE_LIMIT)
  @Post()
  createTransfer(
    @Body(new ZodValidationPipe(createTransferSchema)) body: CreateTransferInput,
    @IdempotencyKey() idempotencyKey: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TransferDto> {
    return this.transferService.createDirectTransfer({
      actorUserId: user.id,
      receiverUserId: body.receiverUserId,
      amountMinor: BigInt(body.amountMinor),
      currency: body.currency,
      note: body.note,
      idempotencyKey,
    });
  }

  @Get(':transferId')
  getTransfer(
    @Param('transferId') transferId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TransferDto> {
    return this.transferQueryService.getForParticipant(transferId, user.id);
  }
}
