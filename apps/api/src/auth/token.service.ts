import { randomBytes, createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppConfigService } from '../config/app-config.service';

interface AccessTokenPayload {
  sub: string;
}

const REFRESH_TOKEN_BYTES = 32;

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
  ) {}

  signAccessToken(userId: string): string {
    const payload: AccessTokenPayload = { sub: userId };
    return this.jwt.sign(payload, {
      secret: this.config.jwtAccessSecret,
      expiresIn: this.config.jwtAccessTtlSeconds,
    });
  }

  /** Generates a fresh, high-entropy refresh token and its lookup hash. Only the hash is ever persisted. */
  generateRefreshToken(): { token: string; hash: string } {
    const token = randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
    return { token, hash: this.hashRefreshToken(token) };
  }

  // SHA-256 (not Argon2id) is deliberate here: the refresh token is already
  // a high-entropy random value, not a low-entropy user-chosen secret, so a
  // fast deterministic hash is appropriate and lets /auth/refresh look the
  // session up directly by hash rather than needing the user id first.
  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  refreshTokenExpiryDate(): Date {
    return new Date(Date.now() + this.config.refreshTokenTtlDays * 24 * 60 * 60 * 1000);
  }
}
