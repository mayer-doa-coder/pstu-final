'use client';

import Link from 'next/link';
import type { ReactElement } from 'react';
import type { LimitWindow } from '../lib/api-types';
import { formatBdt } from '../lib/money';
import { useSession } from '../lib/session-context';
import { Button } from './Button';
import styles from './BalanceCard.module.css';

/** One daily/weekly/monthly send-limit row: usage against the configured ceiling. */
function LimitRow({ label, usage }: { label: string; usage: LimitWindow }): ReactElement {
  const percentUsed =
    usage.limitMinor > 0 ? Math.min(100, (usage.usedMinor / usage.limitMinor) * 100) : 0;
  // Warns before the limit is actually hit, not just after — the same
  // headroom a user would otherwise only discover from a failed transfer.
  const isNearLimit = percentUsed >= 80;

  return (
    <div className={styles.limitRow}>
      <div className={styles.limitRowTop}>
        <span>{label}</span>
        <span className="tabular">
          {formatBdt(usage.usedMinor)} / {formatBdt(usage.limitMinor)}
        </span>
      </div>
      <div className={styles.limitTrack}>
        <div
          className={`${styles.limitFill} ${isNearLimit ? styles.limitFillWarn : ''}`}
          style={{ width: `${percentUsed}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Shows the wallet balance exactly as the API last reported it.
 *
 * The value is never adjusted locally after a transfer — the card refetches
 * GET /wallet instead, so the server stays the only source of truth for money.
 */
export function BalanceCard({ showActions = true }: { showActions?: boolean }): ReactElement {
  const { wallet, walletError, isWalletRefreshing, refreshWallet } = useSession();
  const isUsable = wallet?.status === 'ACTIVE';

  return (
    <section className={styles.card} aria-label="Wallet balance">
      <div className={styles.top}>
        <span className={styles.label}>Available balance</span>
        <button
          type="button"
          className={styles.refresh}
          onClick={() => void refreshWallet()}
          disabled={isWalletRefreshing}
          aria-label="Refresh balance"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 15 15"
            fill="none"
            className={isWalletRefreshing ? styles.spinning : undefined}
            aria-hidden="true"
          >
            <path
              d="M13 7.5a5.5 5.5 0 1 1-1.7-3.97M13 1.5v3.2h-3.2"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {wallet ? (
        <p className={`${styles.value} tabular`}>{formatBdt(wallet.balanceMinor)}</p>
      ) : (
        <div className={styles.skeletonValue} aria-hidden="true" />
      )}

      {wallet ? (
        <div className={styles.meta}>
          <span
            className={`${styles.statusPill} ${isUsable ? styles.statusActive : styles.statusBlocked}`}
          >
            {wallet.currency} · {wallet.status}
          </span>
          <span className={styles.walletId}>Wallet {wallet.walletId.slice(0, 8)}</span>
        </div>
      ) : null}

      {walletError ? <p className={styles.error}>{walletError}</p> : null}

      {!isUsable && wallet ? (
        <p className={styles.error}>
          This wallet is {wallet.status.toLowerCase()} and cannot send or receive money right now.
        </p>
      ) : null}

      {wallet ? (
        <div className={styles.limits}>
          <span className={styles.limitsLabel}>Sending limits</span>
          <LimitRow label="Today" usage={wallet.limits.daily} />
          <LimitRow label="This week" usage={wallet.limits.weekly} />
          <LimitRow label="This month" usage={wallet.limits.monthly} />
        </div>
      ) : null}

      {showActions ? (
        <div className={styles.actions}>
          <Link href="/send">
            <Button variant="accent">Send Money</Button>
          </Link>
          <Link href="/requests">
            <Button variant="secondary">Request Money</Button>
          </Link>
        </div>
      ) : null}
    </section>
  );
}
