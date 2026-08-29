import type { UserStatus, VerificationStatus } from '@prisma/client';

export interface UserProfileDto {
  id: string;
  email: string;
  displayName: string;
  status: UserStatus;
  createdAt: string;
  /** Simulated NID/KYC status — VERIFIED is the badge shown in the UI. */
  verificationStatus: VerificationStatus;
  /** e.g. `••••••7890`. Null until the user has submitted an NID. */
  nidMasked: string | null;
}
