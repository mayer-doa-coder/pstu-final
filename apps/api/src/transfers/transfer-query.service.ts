import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '../common/exceptions/app.exception';
import { ErrorCode } from '../common/exceptions/error-code.enum';
import { RiskRepository } from '../risk/risk.repository';
import { TransfersRepository } from './transfers.repository';
import { toTransferDto } from './transfer.mapper';
import type { TransferDto } from './dto/transfer.dto';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read side of `GET /transfers/:id`. Authorization is a participant check:
 * only the sender or the receiver may see a transfer. A non-participant (or
 * a non-existent id) gets an identical `404 TRANSFER_NOT_FOUND`, so the
 * endpoint can't be used to probe which transfer ids exist
 * (IMPLEMENTATION_GUIDE.md §3.7, AC-5).
 */
@Injectable()
export class TransferQueryService {
  constructor(
    private readonly transfers: TransfersRepository,
    private readonly risk: RiskRepository,
  ) {}

  async getForParticipant(transferId: string, requesterUserId: string): Promise<TransferDto> {
    if (!UUID_PATTERN.test(transferId)) {
      throw this.notFound();
    }

    const transfer = await this.transfers.findById(transferId);
    if (!transfer) {
      throw this.notFound();
    }

    const isParticipant =
      transfer.senderUserId === requesterUserId || transfer.receiverUserId === requesterUserId;
    if (!isParticipant) {
      throw this.notFound();
    }

    // Every SUCCEEDED transfer has one; a PENDING/FAILED transfer (mid- or
    // never-settled) has none yet, so this stays undefined rather than throwing.
    const assessment = await this.risk.findByTransferId(transferId);

    return toTransferDto(
      transfer,
      undefined,
      assessment
        ? {
            score: assessment.score,
            level: assessment.level,
            reasons: assessment.reasons as string[],
            explanation: assessment.explanation,
          }
        : undefined,
    );
  }

  private notFound(): AppException {
    return new AppException(
      HttpStatus.NOT_FOUND,
      ErrorCode.TRANSFER_NOT_FOUND,
      'Transfer not found.',
    );
  }
}
