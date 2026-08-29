import { PasswordService } from './password.service';

describe('PasswordService', () => {
  let service: PasswordService;

  beforeEach(async () => {
    service = new PasswordService();
    await service.onModuleInit();
  });

  it('hashes a password using argon2id', async () => {
    const hash = await service.hash('correct horse battery staple');

    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain('correct horse battery staple');
  });

  it('verifies a correct password against its own hash', async () => {
    const hash = await service.hash('correct horse battery staple');

    await expect(service.verify(hash, 'correct horse battery staple')).resolves.toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await service.hash('correct horse battery staple');

    await expect(service.verify(hash, 'wrong password')).resolves.toBe(false);
  });

  it('rejects a malformed hash instead of throwing', async () => {
    await expect(service.verify('not-a-real-hash', 'anything')).resolves.toBe(false);
  });

  it('exposes a stable argon2id dummy hash for timing-safe unknown-email verification', async () => {
    expect(service.dummyHash).toMatch(/^\$argon2id\$/);
    await expect(service.verify(service.dummyHash, 'anything')).resolves.toBe(false);
  });
});
