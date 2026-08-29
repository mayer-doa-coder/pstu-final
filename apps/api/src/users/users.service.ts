import { HttpStatus, Injectable } from '@nestjs/common';
import { CursorPage } from '../common/pagination/cursor-page';
import { decodeCursor, encodeCursor } from '../common/pagination/cursor.util';
import { AppException } from '../common/exceptions/app.exception';
import { ErrorCode } from '../common/exceptions/error-code.enum';
import { UsersRepository } from './users.repository';
import { toUserProfileDto, toUserSearchResultDto } from './user.mapper';
import type { UserProfileDto } from './dto/user-profile.dto';
import type { UserSearchResultDto } from './dto/user-search-result.dto';
import type { SearchUsersQuery } from './dto/search-users.schema';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  async getProfile(userId: string): Promise<UserProfileDto> {
    const user = await this.usersRepository.findById(userId);

    if (!user) {
      throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.USER_NOT_FOUND, 'User not found.');
    }

    return toUserProfileDto(user);
  }

  async search(query: SearchUsersQuery, currentUserId: string): Promise<CursorPage<UserSearchResultDto>> {
    const cursorId = query.cursor ? this.decodeAndValidateCursor(query.cursor) : undefined;

    // Fetch one extra row to know whether a next page exists, without a
    // separate count query.
    const rows = await this.usersRepository.search({
      query: query.q,
      excludeUserId: currentUserId,
      cursorId,
      take: query.limit + 1,
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const lastRow = page.at(-1);
    const nextCursor = hasMore && lastRow ? encodeCursor(lastRow.id) : null;

    return new CursorPage(page.map(toUserSearchResultDto), nextCursor);
  }

  private decodeAndValidateCursor(cursor: string): string {
    const id = decodeCursor(cursor);
    if (!UUID_PATTERN.test(id)) {
      throw new AppException(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_ERROR, 'Invalid cursor.');
    }
    return id;
  }
}
