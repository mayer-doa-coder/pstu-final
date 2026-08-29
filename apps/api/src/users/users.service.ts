import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '../common/exceptions/app.exception';
import { ErrorCode } from '../common/exceptions/error-code.enum';
import { UsersRepository } from './users.repository';
import { toUserProfileDto } from './user.mapper';
import type { UserProfileDto } from './dto/user-profile.dto';

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
}
