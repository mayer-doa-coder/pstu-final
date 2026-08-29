import { HttpStatus, Injectable } from '@nestjs/common';
import type { User, Wallet } from '@prisma/client';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../database/prisma.service';
import { isUniqueConstraintViolation } from '../database/prisma-errors.util';
import { AppException } from '../common/exceptions/app.exception';
import { ErrorCode } from '../common/exceptions/error-code.enum';
import { UsersRepository } from '../users/users.repository';
import { WalletsRepository } from '../wallets/wallets.repository';
import { AuthSessionRepository } from './auth-session.repository';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import type { RegisterInput } from './dto/register.schema';
import type { LoginInput } from './dto/login.schema';

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersRepository: UsersRepository,
    private readonly walletsRepository: WalletsRepository,
    private readonly authSessionRepository: AuthSessionRepository,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Creates the user and their wallet atomically — see PRD.md §5.2
   * ("No partial user-without-wallet state is allowed"). The unique-email
   * check is the database constraint itself (caught below), not a
   * check-then-insert, which would race under concurrent registrations
   * with the same email.
   */
  async register(input: RegisterInput): Promise<{ user: User; wallet: Wallet }> {
    const passwordHash = await this.passwordService.hash(input.password);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await this.usersRepository.create(
          { email: input.email, displayName: input.displayName, passwordHash },
          tx,
        );
        const wallet = await this.walletsRepository.create(
          { userId: user.id, balanceMinor: this.config.initialWalletBalanceMinor },
          tx,
        );
        return { user, wallet };
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error, 'email')) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.VALIDATION_ERROR,
          'An account with this email already exists.',
        );
      }
      throw error;
    }
  }

  /**
   * Verifies credentials and account status. Runs password verification on
   * every call — even for an unknown email, against a fixed dummy hash — so
   * response time doesn't reveal whether the account exists
   * (PRD.md §4.2 FR-AUTH-002). Account status is only revealed *after*
   * credentials are confirmed correct, since revealing "this account is
   * suspended" to someone who already knows the password is not the same
   * information leak as revealing account existence to a guessing attacker.
   */
  async login(input: LoginInput): Promise<User> {
    const user = await this.usersRepository.findByEmail(input.email);
    const hashToVerify = user?.passwordHash ?? this.passwordService.dummyHash;
    const passwordValid = await this.passwordService.verify(hashToVerify, input.password);

    if (!user || !passwordValid) {
      throw new AppException(HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHENTICATED, 'Invalid email or password.');
    }

    if (user.status === 'SUSPENDED') {
      throw new AppException(HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN, 'This account has been suspended.');
    }

    if (user.status === 'CLOSED') {
      throw new AppException(HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN, 'This account has been closed.');
    }

    return user;
  }

  async createSession(userId: string, userAgent: string | undefined): Promise<IssuedSession> {
    const accessToken = this.tokenService.signAccessToken(userId);
    const { token: refreshToken, hash } = this.tokenService.generateRefreshToken();

    await this.authSessionRepository.create({
      userId,
      refreshTokenHash: hash,
      userAgent,
      expiresAt: this.tokenService.refreshTokenExpiryDate(),
    });

    return { accessToken, refreshToken };
  }

  /**
   * Rotates the refresh token: the presented token is revoked and a new one
   * issued in the same transaction, so a token can be used to refresh at
   * most once (PRD.md §3.7). If a *revoked* token is presented again — the
   * signature of a stolen/replayed token — every active session for that
   * user is revoked rather than trusting any outstanding token.
   */
  async refresh(presentedToken: string | undefined, userAgent: string | undefined): Promise<IssuedSession> {
    if (!presentedToken) {
      throw new AppException(HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHENTICATED, 'Refresh token missing.');
    }

    const hash = this.tokenService.hashRefreshToken(presentedToken);
    const session = await this.authSessionRepository.findByTokenHash(hash);

    if (!session) {
      throw new AppException(HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHENTICATED, 'Invalid session.');
    }

    if (session.revokedAt) {
      await this.authSessionRepository.revokeAllActiveForUser(session.userId);
      throw new AppException(HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHENTICATED, 'Invalid session.');
    }

    if (session.expiresAt.getTime() < Date.now()) {
      throw new AppException(HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHENTICATED, 'Session expired.');
    }

    const accessToken = this.tokenService.signAccessToken(session.userId);
    const { token: newRefreshToken, hash: newHash } = this.tokenService.generateRefreshToken();
    const expiresAt = this.tokenService.refreshTokenExpiryDate();

    await this.prisma.$transaction(async (tx) => {
      await this.authSessionRepository.revoke(session.id, tx);
      await this.authSessionRepository.create({ userId: session.userId, refreshTokenHash: newHash, userAgent, expiresAt }, tx);
    });

    return { accessToken, refreshToken: newRefreshToken };
  }

  /** Idempotent: logging out an already-invalid session still succeeds. */
  async logout(presentedToken: string | undefined): Promise<void> {
    if (!presentedToken) {
      return;
    }

    const hash = this.tokenService.hashRefreshToken(presentedToken);
    const session = await this.authSessionRepository.findByTokenHash(hash);

    if (session && !session.revokedAt) {
      await this.authSessionRepository.revoke(session.id);
    }
  }
}
