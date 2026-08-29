import type { VerificationStatus } from '@prisma/client';

export interface VerificationStatusDto {
  verificationStatus: VerificationStatus;
  /** e.g. `••••••7890` — never the full NID. Null until a first submission. */
  nidMasked: string | null;
  verifiedAt: string | null;
}
