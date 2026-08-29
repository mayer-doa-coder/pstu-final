import { formatBdt, formatSignedBdt, parseBdtToMinor } from './money';

describe('formatBdt', () => {
  it('renders minor units as grouped BDT with two decimals', () => {
    expect(formatBdt(250000)).toBe('৳2,500.00');
    expect(formatBdt(10000000)).toBe('৳100,000.00');
    expect(formatBdt(5)).toBe('৳0.05');
    expect(formatBdt(0)).toBe('৳0.00');
  });

  it('keeps the sign outside the currency mark', () => {
    expect(formatBdt(-250000)).toBe('-৳2,500.00');
  });
});

describe('formatSignedBdt', () => {
  it('marks direction explicitly', () => {
    expect(formatSignedBdt(250000, 'in')).toBe('+৳2,500.00');
    expect(formatSignedBdt(250000, 'out')).toBe('-৳2,500.00');
  });
});

describe('parseBdtToMinor', () => {
  it('parses whole and fractional amounts into integer poisha', () => {
    expect(parseBdtToMinor('2500')).toEqual({ ok: true, amountMinor: 250000 });
    expect(parseBdtToMinor('2,500.75')).toEqual({ ok: true, amountMinor: 250075 });
    expect(parseBdtToMinor('0.05')).toEqual({ ok: true, amountMinor: 5 });
    expect(parseBdtToMinor('0.5')).toEqual({ ok: true, amountMinor: 50 });
  });

  it('avoids binary floating point error on amounts that break parseFloat', () => {
    // 1.15 * 100 is 114.99999999999999 in IEEE-754 doubles.
    expect(parseBdtToMinor('1.15')).toEqual({ ok: true, amountMinor: 115 });
    expect(parseBdtToMinor('8.29')).toEqual({ ok: true, amountMinor: 829 });
  });

  it('rejects amounts that are empty, malformed, or not positive', () => {
    expect(parseBdtToMinor('').ok).toBe(false);
    expect(parseBdtToMinor('abc').ok).toBe(false);
    expect(parseBdtToMinor('1.234').ok).toBe(false);
    expect(parseBdtToMinor('-5').ok).toBe(false);
    expect(parseBdtToMinor('0').ok).toBe(false);
    expect(parseBdtToMinor('0.00').ok).toBe(false);
  });

  it('rejects amounts above the API maximum', () => {
    expect(parseBdtToMinor('10000000000.01').ok).toBe(false);
  });
});
