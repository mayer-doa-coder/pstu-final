import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { IdempotencyKey } from '../common/decorators/idempotency-key.decorator';
import { CsrfGuard } from '../common/guards/csrf.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
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
@UseGuards(JwtAuthGuard)
@Controller('transfers')
export class TransfersController {
  constructor(
    private readonly transferService: TransferService,
    private readonly transferQueryService: TransferQueryService,
  ) {}

  @UseGuards(CsrfGuard)
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
