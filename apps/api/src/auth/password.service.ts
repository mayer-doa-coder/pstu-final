import { Injectable, type OnModuleInit } from '@nestjs/common';
import * as argon2 from 'argon2';

// A random, fixed plaintext hashed once at startup and reused whenever
// login is attempted against an email that doesn't exist. Without this,
// "user not found" would return faster than "wrong password" and leak
// account existence through response timing (PRD.md §4.2 FR-AUTH-002).
const TIMING_SAFE_DUMMY_PASSWORD = 'a-fixed-value-that-is-never-a-real-password';

@Injectable()
export class PasswordService implements OnModuleInit {
  private dummyHashValue = '';

  async onModuleInit(): Promise<void> {
    this.dummyHashValue = await this.hash(TIMING_SAFE_DUMMY_PASSWORD);
  }

  hash(plain: string): Promise<string> {
    return argon2.hash(plain, { type: argon2.argon2id });
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }

  /** Hash of a fixed, never-real password — see TIMING_SAFE_DUMMY_PASSWORD above. */
  get dummyHash(): string {
    return this.dummyHashValue;
  }
}
