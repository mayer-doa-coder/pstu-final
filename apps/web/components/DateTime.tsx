'use client';

import { useEffect, useState, type ReactElement } from 'react';

/**
 * Renders an ISO timestamp in the viewer's locale.
 *
 * Formatting is deferred to an effect so the server-rendered markup and the
 * first client render agree (the server has no access to the browser's time
 * zone), avoiding a hydration mismatch.
 */
export function DateTime({ value, mode = 'full' }: { value: string; mode?: 'full' | 'short' }): ReactElement {
  const [formatted, setFormatted] = useState<string | null>(null);

  useEffect(() => {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      setFormatted(value);
      return;
    }

    setFormatted(
      date.toLocaleString(undefined, {
        dateStyle: mode === 'full' ? 'medium' : 'short',
        timeStyle: 'short',
      }),
    );
  }, [value, mode]);

  return <time dateTime={value}>{formatted ?? '—'}</time>;
}
