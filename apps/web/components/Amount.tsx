import type { ReactElement } from 'react';
import { formatBdt, formatSignedBdt } from '../lib/money';

/**
 * Renders a BDT amount from integer minor units. Direction is conveyed by the
 * sign and an assistive label as well as by colour, so it does not depend on
 * colour perception alone.
 */
export function Amount({
  amountMinor,
  direction,
  className,
}: {
  amountMinor: number;
  direction?: 'in' | 'out';
  className?: string;
}): ReactElement {
  if (!direction) {
    return (
      <span className={['tabular', className ?? ''].filter(Boolean).join(' ')}>
        {formatBdt(amountMinor)}
      </span>
    );
  }

  return (
    <span className={['tabular', className ?? ''].filter(Boolean).join(' ')}>
      <span className="srOnly">{direction === 'in' ? 'Received' : 'Sent'} </span>
      {formatSignedBdt(amountMinor, direction)}
    </span>
  );
}
