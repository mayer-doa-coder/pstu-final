import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditAction } from '../audit/audit-action.enum';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/exceptions/app.exception';
import { ErrorCode } from '../common/exceptions/error-code.enum';
import { PrismaService } from '../database/prisma.service';
import { isUniqueConstraintViolation } from '../database/prisma-errors.util';
import { UsersRepository } from '../users/users.repository';
import { toVerificationStatusDto } from './verification.mapper';
import { hashNid, maskNid, simulateNidCheck } from './nid.util';
import type { VerificationStatusDto } from './dto/verification-status.dto';

/**
 * Simulated NID/KYC verification. VERIFIED is the only terminal state — a
 * REJECTED (or still-UNVERIFIED) user may resubmit, since a real KYC flow
 * routinely needs a second attempt (typo, expired document, etc.).
 *
 * This never touches a wallet or transfer; it only updates the user's own
 * row, so unlike the transfer/money-request paths it does not need
 * idempotency-key retry safety — resubmitting the same NID is naturally a
 * no-op (see `submitNid`), and resubmitting a different one is a new,
 * legitimate attempt.
 */
@Injectable()
export class VerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersRepository,
    private readonly audit: AuditService,
  ) {}

  async submitNid(actorUserId: string, nidNumber: string): Promise<VerificationStatusDto> {
    const current = await this.users.findById(actorUserId);
    if (!current) {
      // The authenticated caller always has a user row.
      throw new AppException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        ErrorCode.INTERNAL_ERROR,
        'User not found.',
      );
    }

    const nidHash = hashNid(nidNumber);

    // Already verified with this exact NID: idempotent no-op, not an error.
    if (current.verificationStatus === 'VERIFIED' && current.nidHash === nidHash) {
      return toVerificationStatusDto(current);
    }
    if (current.verificationStatus === 'VERIFIED') {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.VALIDATION_ERROR,
        'This account is already verified.',
      );
    }

    const existingOwner = await this.users.findByNidHash(nidHash);
    if (existingOwner && existingOwner.id !== actorUserId) {
      // Same rule a real KYC system enforces: one NID, one account. Never
      // reveal whose account it is — that would leak the other user's identity.
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.VALIDATION_ERROR,
        'This NID is already associated with another account.',
      );
    }

    const verified = simulateNidCheck(nidNumber);
    const nidMasked = maskNid(nidNumber);

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const row = await this.users.setVerification(
          actorUserId,
          {
            nidHash,
            nidMasked,
            verificationStatus: verified ? 'VERIFIED' : 'REJECTED',
            verifiedAt: verified ? new Date() : null,
          },
          tx,
        );

        await this.audit.record(tx, {
          actorUserId,
          action: verified ? AuditAction.NID_VERIFIED : AuditAction.NID_REJECTED,
          resourceType: 'user',
          resourceId: actorUserId,
          // The masked form only — the full NID is never audited or logged.
          metadata: { nidMasked },
        });

        return row;
      });

      return toVerificationStatusDto(updated);
    } catch (error) {
      // A last-line guard against a race where two requests hash-collide on
      // the same brand-new NID between the check above and this write.
      if (isUniqueConstraintViolation(error, 'nidHash')) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.VALIDATION_ERROR,
          'This NID is already associated with another account.',
        );
      }
      throw error;
    }
  }
}
