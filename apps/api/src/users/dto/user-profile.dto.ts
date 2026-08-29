import type { UserStatus } from '@prisma/client';

export interface UserProfileDto {
  id: string;
  email: string;
  displayName: string;
  status: UserStatus;
  createdAt: string;
}
