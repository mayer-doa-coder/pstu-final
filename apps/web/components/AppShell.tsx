'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { useSession } from '../lib/session-context';
import { Button } from './Button';
import styles from './AppShell.module.css';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/send', label: 'Send Money' },
  { href: '/requests', label: 'Requests' },
  { href: '/activity', label: 'Activity' },
  { href: '/notifications', label: 'Notifications' },
] as const;

function initials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return `${first}${second}`.toUpperCase();
}

export function AppShell({ children }: { children: ReactNode }): ReactElement {
  const pathname = usePathname();
  const router = useRouter();
  const { user, signOut } = useSession();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  // Close the mobile menu whenever the route changes.
  useEffect(() => {
    setIsMenuOpen(false);
  }, [pathname]);

  async function handleSignOut(): Promise<void> {
    if (isSigningOut) {
      return;
    }

    setIsSigningOut(true);
    try {
      await signOut();
      router.replace('/login');
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/dashboard" className={styles.brand}>
            <span className={styles.brandMark} aria-hidden="true">
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                <rect x="1.5" y="1" width="3" height="9" rx="1" fill="#57e08a" />
                <rect x="6.5" y="1" width="3" height="9" rx="1" fill="#ffffff" />
              </svg>
            </span>
            Money Movement
          </Link>

          <button
            type="button"
            className={styles.menuButton}
            onClick={() => setIsMenuOpen((open) => !open)}
            aria-expanded={isMenuOpen}
            aria-label={isMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d={isMenuOpen ? 'M3 3l10 10M13 3L3 13' : 'M2 4h12M2 8h12M2 12h12'}
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>

          <nav
            className={`${styles.nav} ${isMenuOpen ? styles.navOpen : ''}`}
            aria-label="Main navigation"
          >
            {NAV_ITEMS.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`${styles.navLink} ${isActive ? styles.navLinkActive : ''}`}
                  aria-current={isActive ? 'page' : undefined}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className={`${styles.account} ${isMenuOpen ? '' : styles.accountCollapsed}`}>
            <span className={styles.avatar} aria-hidden="true">
              {user ? initials(user.displayName) : '··'}
            </span>
            <span className={styles.accountName}>{user?.displayName ?? 'Signed in'}</span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void handleSignOut()}
              isLoading={isSigningOut}
            >
              Log out
            </Button>
          </div>
        </div>
      </header>

      <main className={styles.main}>{children}</main>

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <span>Money Movement — closed-loop simulated BDT wallet.</span>
          <span>No real funds are involved.</span>
        </div>
      </footer>
    </div>
  );
}
