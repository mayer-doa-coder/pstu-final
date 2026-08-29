import { hashRequestPayload } from './request-hash.util';

describe('hashRequestPayload', () => {
  it('is stable regardless of object key order', () => {
    const a = hashRequestPayload({
      receiverUserId: 'u1',
      amountMinor: '250000',
      currency: 'BDT',
      note: null,
    });
    const b = hashRequestPayload({
      note: null,
      currency: 'BDT',
      amountMinor: '250000',
      receiverUserId: 'u1',
    });
    expect(a).toBe(b);
  });

  it('changes when any field changes', () => {
    const base = hashRequestPayload({
      receiverUserId: 'u1',
      amountMinor: '250000',
      currency: 'BDT',
      note: null,
    });
    expect(
      hashRequestPayload({
        receiverUserId: 'u1',
        amountMinor: '250001',
        currency: 'BDT',
        note: null,
      }),
    ).not.toBe(base);
    expect(
      hashRequestPayload({
        receiverUserId: 'u2',
        amountMinor: '250000',
        currency: 'BDT',
        note: null,
      }),
    ).not.toBe(base);
    expect(
      hashRequestPayload({
        receiverUserId: 'u1',
        amountMinor: '250000',
        currency: 'BDT',
        note: 'x',
      }),
    ).not.toBe(base);
  });

  it('distinguishes nested key order too and produces a sha-256 hex digest', () => {
    const hash = hashRequestPayload({ a: { x: 1, y: 2 }, b: [1, 2, 3] });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRequestPayload({ b: [1, 2, 3], a: { y: 2, x: 1 } })).toBe(hash);
  });
});
