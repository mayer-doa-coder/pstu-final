import { validateEnv } from './env.schema';

describe('validateEnv', () => {
  const validEnv = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
  };

  it('applies defaults for optional fields', () => {
    const config = validateEnv(validEnv);

    expect(config.NODE_ENV).toBe('development');
    expect(config.PORT).toBe(4000);
    expect(config.CORS_ORIGINS).toBe('http://localhost:3000');
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.JWT_ACCESS_TTL_SECONDS).toBe(900);
    expect(config.REFRESH_TOKEN_TTL_DAYS).toBe(7);
    expect(config.INITIAL_WALLET_BALANCE_MINOR).toBe(10_000_000);
  });

  it('coerces PORT to a number', () => {
    const config = validateEnv({ ...validEnv, PORT: '5000' });

    expect(config.PORT).toBe(5000);
  });

  it('throws when DATABASE_URL is missing', () => {
    const { DATABASE_URL: _omit, ...rest } = validEnv;

    expect(() => validateEnv(rest)).toThrow(/DATABASE_URL/);
  });

  it('throws when REDIS_URL is missing', () => {
    const { REDIS_URL: _omit, ...rest } = validEnv;

    expect(() => validateEnv(rest)).toThrow(/REDIS_URL/);
  });

  it('rejects an unsupported NODE_ENV value', () => {
    expect(() => validateEnv({ ...validEnv, NODE_ENV: 'staging' })).toThrow();
  });

  it('throws when JWT_ACCESS_SECRET is missing', () => {
    const { JWT_ACCESS_SECRET: _omit, ...rest } = validEnv;

    expect(() => validateEnv(rest)).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('rejects a JWT_ACCESS_SECRET shorter than 32 characters', () => {
    expect(() => validateEnv({ ...validEnv, JWT_ACCESS_SECRET: 'too-short' })).toThrow(/JWT_ACCESS_SECRET/);
  });
});
