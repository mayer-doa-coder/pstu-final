'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactElement } from 'react';
import { useSession } from '../lib/session-context';

/**
 * Entry route. Sends signed-in users to the dashboard and everyone else to
 * sign in, so there is a single landing destination either way.
 */
export default function HomePage(): ReactElement {
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'authenticated') {
      router.replace('/dashboard');
    } else if (status === 'anonymous') {
      router.replace('/login');
    }
  }, [status, router]);

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
      <p role="status" aria-live="polite" style={{ color: 'var(--ink-soft)', fontSize: 14 }}>
        Loading Money Movement…
      </p>
    </main>
  );
}
