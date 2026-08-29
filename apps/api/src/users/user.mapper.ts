import type { User } from '@prisma/client';
import { maskEmail } from './email-mask.util';
import type { UserProfileDto } from './dto/user-profile.dto';
import type { UserSearchResultDto } from './dto/user-search-result.dto';

export function toUserProfileDto(user: User): UserProfileDto {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
  };
}

export function toUserSearchResultDto(
  user: Pick<User, 'id' | 'displayName' | 'email'>,
): UserSearchResultDto {
  return {
    id: user.id,
    displayName: user.displayName,
    maskedEmail: maskEmail(user.email),
  };
}
