'use client';

import Link from 'next/link';
import type { ReactElement } from 'react';
import { ActivityList } from '../../../components/ActivityList';
import { BalanceCard } from '../../../components/BalanceCard';
import { Alert, Card, EmptyState } from '../../../components/Feedback';
import { Button } from '../../../components/Button';
import { DateTime } from '../../../components/DateTime';
import { TransferListSkeleton } from '../../../components/TransferList';
import { useActivity } from '../../../lib/use-activity';
import { useSession } from '../../../lib/session-context';
import { formatBdt } from '../../../lib/money';
import styles from './dashboard.module.css';

const PREVIEW_COUNT = 4;

function greetingFor(date: Date): string {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function DashboardPage(): ReactElement {
  const { user, wallet } = useSession();
  const { items, isLoading, error } = useActivity({ limit: PREVIEW_COUNT });

  const sentRecently = items
    .filter(
      (item) => item.type === 'TRANSFER' && item.direction === 'OUT' && item.status === 'SUCCEEDED',
    )
    .reduce((total, item) => total + item.amountMinor, 0);

  const firstName = user?.displayName.trim().split(/\s+/)[0] ?? 'there';

  return (
    <>
      <header className={styles.header}>
        <h1 className={styles.greeting}>
          {greetingFor(new Date())}, <span className={styles.greetingAccent}>{firstName}</span>
        </h1>
        <p className={styles.subtitle}>Here is your wallet and what has happened recently.</p>
      </header>

      <div className={styles.grid}>
        <div className={styles.column}>
          <BalanceCard />

          <Card
            title="Recent activity"
            subtitle="Your most recent transfers and requests, straight from the server."
            action={
              <Link href="/activity" className={styles.viewAll}>
                View all
              </Link>
            }
          >
            {error ? <Alert tone="warning">{error}</Alert> : null}

            {isLoading && items.length === 0 ? (
              <TransferListSkeleton rows={3} />
            ) : items.length === 0 ? (
              <EmptyState
                title="Nothing here yet"
                description="Once you send money or request it, each one appears here with its live status."
                action={
                  <Link href="/send">
                    <Button variant="accent" size="sm">
                      Send your first transfer
                    </Button>
                  </Link>
                }
              />
            ) : (
              <ActivityList items={items} />
            )}
          </Card>
        </div>

        <div className={styles.column}>
          <Card title="Recently">
            <div className={styles.summaryGrid}>
              <div className={styles.summaryTile}>
                <span className={styles.summaryLabel}>Activity</span>
                <span className={`${styles.summaryValue} tabular`}>{items.length}</span>
                <span className={styles.summaryNote}>Shown above</span>
              </div>
              <div className={styles.summaryTile}>
                <span className={styles.summaryLabel}>Sent</span>
                <span className={`${styles.summaryValue} tabular`}>{formatBdt(sentRecently)}</span>
                <span className={styles.summaryNote}>Succeeded transfers only</span>
              </div>
            </div>
          </Card>

          <Card title="Your account">
            <div className={styles.identity}>
              <div className={styles.identityRow}>
                <span className={styles.identityLabel}>Name</span>
                <span className={styles.identityValue}>{user?.displayName ?? '—'}</span>
              </div>
              <div className={styles.identityRow}>
                <span className={styles.identityLabel}>Email</span>
                <span className={styles.identityValue}>{user?.email ?? '—'}</span>
              </div>
              <div className={styles.identityRow}>
                <span className={styles.identityLabel}>Status</span>
                <span className={styles.identityValue}>{user?.status ?? '—'}</span>
              </div>
              <div className={styles.identityRow}>
                <span className={styles.identityLabel}>Wallet</span>
                <span className={styles.identityValue}>
                  {wallet ? `${wallet.currency} · ${wallet.status}` : '—'}
                </span>
              </div>
              <div className={styles.identityRow}>
                <span className={styles.identityLabel}>Member since</span>
                <span className={styles.identityValue}>
                  {user ? <DateTime value={user.createdAt} mode="short" /> : '—'}
                </span>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
