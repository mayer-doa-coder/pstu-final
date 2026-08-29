import { RiskEngineService, type RiskContext } from './risk-engine.service';

const NOW = new Date('2026-06-15T12:00:00.000Z');
const THIRTY_DAYS_AGO = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000);

/** No rule fires: an established, verified sender sending an ordinary amount to an established receiver. */
function baseline(overrides: Partial<RiskContext> = {}): RiskContext {
  return {
    amountMinor: 12_345n,
    senderBalanceBeforeMinor: 100_000_000n,
    senderCreatedAt: THIRTY_DAYS_AGO,
    receiverCreatedAt: THIRTY_DAYS_AGO,
    senderVerificationStatus: 'VERIFIED',
    senderRecentTransferCount: 0,
    now: NOW,
    ...overrides,
  };
}

describe('RiskEngineService', () => {
  const engine = new RiskEngineService();

  it('scores an unremarkable transfer as LOW with no reasons', () => {
    const result = engine.evaluate(baseline());
    expect(result).toEqual({ score: 0, level: 'LOW', reasons: [] });
  });

  it('flags an amount that is a large share of the sender balance', () => {
    const result = engine.evaluate(
      baseline({ senderBalanceBeforeMinor: 100_000n, amountMinor: 80_000n }),
    );
    expect(result.score).toBe(25);
    expect(result.reasons).toEqual(["Amount is a large share of the sender's available balance."]);
  });

  it('does not flag balance ratio when the sender has a zero balance', () => {
    // 0-balance senders fail on INSUFFICIENT_BALANCE before risk is even
    // evaluated in practice, but the rule itself must not divide by zero.
    const result = engine.evaluate(baseline({ senderBalanceBeforeMinor: 0n, amountMinor: 1n }));
    expect(result.reasons).not.toContain(
      "Amount is a large share of the sender's available balance.",
    );
  });

  it('flags an unusually large absolute amount', () => {
    const result = engine.evaluate(baseline({ amountMinor: 50_000_001n }));
    expect(result.score).toBe(20);
    expect(result.reasons).toEqual(['Transfer amount is unusually large.']);
  });

  it('flags a sender account created less than 24 hours ago', () => {
    const result = engine.evaluate(
      baseline({ senderCreatedAt: new Date(NOW.getTime() - 60 * 60 * 1000) }),
    );
    expect(result.score).toBe(15);
    expect(result.reasons).toEqual(['Sender account was created less than 24 hours ago.']);
  });

  it.each(['UNVERIFIED', 'REJECTED'] as const)('flags a %s sender', (status) => {
    const result = engine.evaluate(baseline({ senderVerificationStatus: status }));
    expect(result.score).toBe(15);
    expect(result.reasons).toEqual(['Sender has not completed NID verification.']);
  });

  it('flags a receiver account created less than 24 hours ago', () => {
    const result = engine.evaluate(
      baseline({ receiverCreatedAt: new Date(NOW.getTime() - 60 * 60 * 1000) }),
    );
    expect(result.score).toBe(10);
    expect(result.reasons).toEqual(['Receiver account was created less than 24 hours ago.']);
  });

  it('flags a suspiciously round amount at or above the threshold', () => {
    const result = engine.evaluate(baseline({ amountMinor: 15_000_000n })); // BDT 150,000, exact multiple of 50,000
    expect(result.score).toBe(10);
    expect(result.reasons).toEqual(['Amount is a suspiciously round figure.']);
  });

  it('does not flag a round-looking amount below the threshold', () => {
    const result = engine.evaluate(baseline({ amountMinor: 10_000n })); // BDT 100.00 — round but tiny
    expect(result.reasons).toEqual([]);
  });

  it('flags high transfer velocity', () => {
    const result = engine.evaluate(baseline({ senderRecentTransferCount: 5 }));
    expect(result.score).toBe(25);
    expect(result.reasons).toEqual(['Sender has made several transfers in a short time window.']);
  });

  it('reaches MEDIUM exactly at the 25-point boundary', () => {
    const result = engine.evaluate(
      baseline({
        senderVerificationStatus: 'UNVERIFIED', // 15
        receiverCreatedAt: new Date(NOW.getTime() - 60 * 60 * 1000), // 10
      }),
    );
    expect(result.score).toBe(25);
    expect(result.level).toBe('MEDIUM');
  });

  it('stays MEDIUM just below the 50-point HIGH boundary', () => {
    const result = engine.evaluate(
      baseline({
        amountMinor: 50_000_001n, // 20
        senderCreatedAt: new Date(NOW.getTime() - 60 * 60 * 1000), // 15
      }),
    );
    expect(result.score).toBe(35);
    expect(result.level).toBe('MEDIUM');
  });

  it('reaches HIGH exactly at the 50-point boundary, with reasons in rule order', () => {
    const result = engine.evaluate(
      baseline({
        senderBalanceBeforeMinor: 100_000n,
        amountMinor: 80_000n, // 25, LARGE_RELATIVE_TO_BALANCE
        senderRecentTransferCount: 5, // 25, HIGH_VELOCITY
      }),
    );
    expect(result.score).toBe(50);
    expect(result.level).toBe('HIGH');
    expect(result.reasons).toEqual([
      "Amount is a large share of the sender's available balance.",
      'Sender has made several transfers in a short time window.',
    ]);
  });

  it('is a pure function of its input: identical context always yields an identical result', () => {
    const ctx = baseline({ amountMinor: 60_000_000n, senderVerificationStatus: 'REJECTED' });
    expect(engine.evaluate(ctx)).toEqual(engine.evaluate(ctx));
  });
});
