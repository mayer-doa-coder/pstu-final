'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactElement, type ReactNode } from 'react';
import { AppShell } from '../../components/AppShell';
import { useSession } from '../../lib/session-context';
import styles from './app-layout.module.css';

/**
 * Client-side guard for the signed-in area.
 *
 * This is a routing convenience only — it is not the security boundary. Every
 * protected endpoint is guarded server-side by JwtAuthGuard against the
 * httpOnly cookie, so a user who bypasses this still gets a 401 from the API.
 */
export default function AppLayout({ children }: { children: ReactNode }): ReactElement {
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'anonymous') {
      router.replace('/login');
    }
  }, [status, router]);

  if (status !== 'authenticated') {
    return (
      <div className={styles.gate} role="status" aria-live="polite">
        <span className={styles.gateSpinner} aria-hidden="true" />
        <p className={styles.gateText}>
          {status === 'loading' ? 'Loading your wallet…' : 'Redirecting to sign in…'}
        </p>
      </div>
    );
  }

  return <AppShell>{children}</AppShell>;
}
