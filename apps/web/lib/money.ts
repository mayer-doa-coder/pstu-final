/**
 * Money is integer minor units (poisha) end to end — never a float, never a
 * decimal string in arithmetic. These helpers only *format* and *parse* at the
 * UI boundary; no balance is ever computed here (CLAUDE.md §1, §"never
 * calculate authoritative balances locally").
 */

const MINOR_PER_MAJOR = 100;

/** Largest amount the API accepts: BDT 10,000,000,000 expressed in poisha. */
export const MAX_AMOUNT_MINOR = 1_000_000_000_000;

/** `250000` -> `"2,500.00"` (no currency symbol). */
export function formatMinorAmount(amountMinor: number): string {
  const negative = amountMinor < 0;
  const absolute = Math.abs(amountMinor);
  const major = Math.trunc(absolute / MINOR_PER_MAJOR);
  const minor = absolute % MINOR_PER_MAJOR;
  const majorText = major.toLocaleString('en-US');
  const minorText = minor.toString().padStart(2, '0');

  return `${negative ? '-' : ''}${majorText}.${minorText}`;
}

/** `250000` -> `"৳2,500.00"`. */
export function formatBdt(amountMinor: number): string {
  const negative = amountMinor < 0;
  return `${negative ? '-' : ''}৳${formatMinorAmount(Math.abs(amountMinor))}`;
}

/** `250000` -> `"+৳2,500.00"` / `"-৳2,500.00"` for directional rows. */
export function formatSignedBdt(amountMinor: number, direction: 'in' | 'out'): string {
  return `${direction === 'in' ? '+' : '-'}৳${formatMinorAmount(Math.abs(amountMinor))}`;
}

export type AmountParseResult =
  | { ok: true; amountMinor: number }
  | { ok: false; message: string };

/**
 * Parses a user-typed BDT amount ("2,500.75") into integer poisha.
 *
 * Parsing is done on the digit string rather than via `parseFloat * 100` so no
 * binary floating-point rounding can ever enter the money path.
 */
export function parseBdtToMinor(raw: string): AmountParseResult {
  const cleaned = raw.trim().replace(/,/g, '');

  if (cleaned.length === 0) {
    return { ok: false, message: 'Enter an amount.' };
  }

  if (!/^\d*(\.\d{0,2})?$/.test(cleaned)) {
    return { ok: false, message: 'Enter a valid amount, up to 2 decimal places.' };
  }

  const [majorPart = '', minorPart = ''] = cleaned.split('.');

  if (majorPart.length === 0 && minorPart.length === 0) {
    return { ok: false, message: 'Enter an amount.' };
  }

  const major = majorPart.length > 0 ? Number(majorPart) : 0;
  const minor = Number(minorPart.padEnd(2, '0'));
  const amountMinor = major * MINOR_PER_MAJOR + minor;

  if (!Number.isSafeInteger(amountMinor)) {
    return { ok: false, message: 'That amount is too large.' };
  }

  if (amountMinor <= 0) {
    return { ok: false, message: 'Amount must be greater than zero.' };
  }

  if (amountMinor > MAX_AMOUNT_MINOR) {
    return { ok: false, message: 'That amount exceeds the maximum allowed.' };
  }

  return { ok: true, amountMinor };
}
