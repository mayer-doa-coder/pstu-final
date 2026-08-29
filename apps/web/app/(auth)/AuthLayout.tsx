'use client';

import Link from 'next/link';
import type { ReactElement, ReactNode } from 'react';
import styles from './auth.module.css';

const POINTS = [
  'Every transfer is atomic — it fully happens, or not at all.',
  'Retrying a payment never sends it twice.',
  'Balances are held in integer poisha, never a rounded float.',
] as const;

export function AuthLayout({
  eyebrow,
  title,
  titleAccent,
  subtitle,
  children,
  footer,
}: {
  eyebrow: string;
  title: string;
  titleAccent: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}): ReactElement {
  return (
    <div className={styles.page}>
      <div className={styles.formSide}>
        <Link href="/" className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <rect x="1.5" y="1" width="3" height="9" rx="1" fill="#57e08a" />
              <rect x="6.5" y="1" width="3" height="9" rx="1" fill="#ffffff" />
            </svg>
          </span>
          Money Movement
        </Link>

        <div className={styles.formWrap}>
          <span className={styles.eyebrow}>{eyebrow}</span>
          <h1 className={styles.title}>
            {title} <span className={styles.titleAccent}>{titleAccent}</span>
          </h1>
          <p className={styles.subtitle}>{subtitle}</p>
          {children}
          <p className={styles.switchLine}>{footer}</p>
        </div>
      </div>

      <aside className={styles.aside}>
        <h2 className={styles.asideTitle}>
          Move money <span className={styles.asideAccent}>safely.</span>
        </h2>
        <p className={styles.asideText}>
          A closed-loop simulated BDT wallet built the way a real payments system is built —
          transactional, idempotent, and auditable.
        </p>

        <div className={styles.balanceCard}>
          <p className={styles.balanceLabel}>Wallet balance</p>
          <p className={`${styles.balanceValue} tabular`}>৳1,00,000.00</p>
          <p className={styles.balanceNote}>Example only. Your real balance loads after sign in.</p>
        </div>

        <ul className={styles.points}>
          {POINTS.map((point) => (
            <li key={point} className={styles.point}>
              <span className={styles.pointMark} aria-hidden="true">
                ✓
              </span>
              {point}
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
