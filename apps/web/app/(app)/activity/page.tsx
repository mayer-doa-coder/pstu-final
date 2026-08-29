'use client';

import Link from 'next/link';
import { useState, type ReactElement } from 'react';
import { ActivityList } from '../../../components/ActivityList';
import { Button } from '../../../components/Button';
import { Alert, Card, EmptyState } from '../../../components/Feedback';
import { TransferListSkeleton } from '../../../components/TransferList';
import { useActivity } from '../../../lib/use-activity';
import type { ActivityType } from '../../../lib/api-types';
import styles from '../page-header.module.css';

type Filter = 'all' | 'transfer' | 'request';

const FILTERS: Array<{ key: Filter; label: string; type?: ActivityType }> = [
  { key: 'all', label: 'All' },
  { key: 'transfer', label: 'Transfers', type: 'TRANSFER' },
  { key: 'request', label: 'Requests', type: 'MONEY_REQUEST' },
];

export default function ActivityPage(): ReactElement {
  const [filter, setFilter] = useState<Filter>('all');
  const activeType = FILTERS.find((option) => option.key === filter)?.type;
  const { items, isLoading, isLoadingMore, hasMore, error, reload, loadMore } = useActivity({
    type: activeType,
  });

  return (
    <div className={styles.stack}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Activity</h1>
          <p className={styles.subtitle}>
            Every transfer and money request you are part of, straight from the server.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={reload} isLoading={isLoading}>
          Refresh
        </Button>
      </header>

      <Card>
        <div className={styles.tabs} role="tablist" aria-label="Filter activity">
          {FILTERS.map((option) => (
            <button
              key={option.key}
              type="button"
              role="tab"
              aria-selected={filter === option.key}
              className={`${styles.tab} ${filter === option.key ? styles.tabActive : ''}`}
              onClick={() => setFilter(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>

        {error ? <Alert tone="warning">{error}</Alert> : null}

        {isLoading ? (
          <TransferListSkeleton rows={5} />
        ) : items.length === 0 ? (
          <EmptyState
            title="No activity yet"
            description="Transfers and money requests you are part of appear here as soon as they happen."
            action={
              <Link href="/send">
                <Button variant="accent" size="sm">
                  Send money
                </Button>
              </Link>
            }
          />
        ) : (
          <>
            <ActivityList items={items} />
            {hasMore ? (
              <div style={{ marginTop: 'var(--space-4)', textAlign: 'center' }}>
                <Button
                  variant="secondary"
                  onClick={() => void loadMore()}
                  isLoading={isLoadingMore}
                >
                  Load more
                </Button>
              </div>
            ) : null}
          </>
        )}
      </Card>
    </div>
  );
}
