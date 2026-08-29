import type { User } from '@prisma/client';
import type { VerificationStatusDto } from './dto/verification-status.dto';

export function toVerificationStatusDto(user: User): VerificationStatusDto {
  return {
    verificationStatus: user.verificationStatus,
    nidMasked: user.nidMasked,
    verifiedAt: user.verifiedAt ? user.verifiedAt.toISOString() : null,
  };
}
