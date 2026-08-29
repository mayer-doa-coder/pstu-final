import { createHash } from 'node:crypto';

/** Bangladesh NID formats this demo accepts: the 10-digit legacy number or the 17-digit Smart NID. */
export const NID_PATTERN = /^\d{10}$|^\d{17}$/;

/** SHA-256 hex of the NID — the only form of it ever persisted (see schema.prisma). */
export function hashNid(nidNumber: string): string {
  return createHash('sha256').update(nidNumber).digest('hex');
}

/** `1234567890` -> `••••••7890` — enough to recognize, never enough to reuse. */
export function maskNid(nidNumber: string): string {
  const visible = nidNumber.slice(-4);
  return `${'•'.repeat(nidNumber.length - visible.length)}${visible}`;
}

/**
 * Stands in for a real NID Verification System call. Deterministic — the
 * same number always resolves the same way, which is what makes a "simulated"
 * verifier honest to demo rather than a coin flip: given a digit sum ending
 * in zero (~1-in-10 numbers) it reports REJECTED, otherwise VERIFIED.
 */
export function simulateNidCheck(nidNumber: string): boolean {
  const digitSum = nidNumber
    .split('')
    .reduce((total, digit) => total + Number.parseInt(digit, 10), 0);
  return digitSum % 10 !== 0;
}
