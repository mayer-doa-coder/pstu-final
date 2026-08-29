const MINOR_UNITS_PER_MAJOR = 100n;

/**
 * Renders integer minor units (poisha) as a display string like `৳2,500.00`.
 *
 * Uses BigInt division and remainder rather than `amount / 100` — dividing by
 * 100 in floating point is exactly the class of bug this codebase forbids for
 * money, and this string ends up in notification text a user reads.
 */
export function formatMinorUnits(amountMinor: bigint, currency = 'BDT'): string {
  const negative = amountMinor < 0n;
  const absolute = negative ? -amountMinor : amountMinor;

  const major = absolute / MINOR_UNITS_PER_MAJOR;
  const minor = absolute % MINOR_UNITS_PER_MAJOR;

  const grouped = major.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const symbol = currency === 'BDT' ? '৳' : `${currency} `;

  return `${negative ? '-' : ''}${symbol}${grouped}.${minor.toString().padStart(2, '0')}`;
}
