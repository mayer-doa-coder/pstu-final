import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CursorPage } from '../common/pagination/cursor-page';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { RateLimitGuard } from '../common/rate-limit/rate-limit.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { UsersService } from './users.service';
import { searchUsersQuerySchema, type SearchUsersQuery } from './dto/search-users.schema';
import type { UserProfileDto } from './dto/user-profile.dto';
import type { UserSearchResultDto } from './dto/user-search-result.dto';

// 30 requests/minute per user: generous enough for normal "type to search"
// use, tight enough to blunt enumeration attempts (PRD.md §4.3, Risk 10).
const SEARCH_RATE_LIMIT = { limit: 30, windowSeconds: 60 };

@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): Promise<UserProfileDto> {
    return this.usersService.getProfile(user.id);
  }

  @UseGuards(RateLimitGuard)
  @RateLimit(SEARCH_RATE_LIMIT)
  @Get('search')
  search(
    @Query(new ZodValidationPipe(searchUsersQuerySchema)) query: SearchUsersQuery,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CursorPage<UserSearchResultDto>> {
    return this.usersService.search(query, user.id);
  }
}
