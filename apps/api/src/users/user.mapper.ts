import type { User } from '@prisma/client';
import type { UserProfileDto } from './dto/user-profile.dto';

export function toUserProfileDto(user: User): UserProfileDto {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
  };
}
