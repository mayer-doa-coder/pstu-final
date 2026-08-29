'use client';

import type { ReactElement } from 'react';
import type { ActivityItem } from '../lib/api-types';
import { Amount } from './Amount';
import { DateTime } from './DateTime';
import { Badge, type BadgeTone } from './Feedback';
import styles from './TransferList.module.css';

const STATUS_TONE: Record<string, BadgeTone> = {
  SUCCEEDED: 'success',
  ACCEPTED: 'success',
  PENDING: 'pending',
  FAILED: 'danger',
  DECLINED: 'danger',
  CANCELLED: 'neutral',
  EXPIRED: 'neutral',
};

function counterpartyLabel(item: ActivityItem): string {
  return item.counterparty?.displayName ?? `user ${item.counterparty?.userId.slice(0, 8) ?? '—'}`;
}

function titleFor(item: ActivityItem): string {
  const who = counterpartyLabel(item);
  if (item.type === 'TRANSFER') {
    return item.direction === 'IN' ? `Received from ${who}` : `Sent to ${who}`;
  }
  return `Money request with ${who}`;
}

function Glyph({ item }: { item: ActivityItem }): ReactElement {
  if (item.direction === 'REQUEST') {
    return (
      <span className={`${styles.glyph} ${styles.glyphOut}`} aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M8 5v3.3l2.2 1.3"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </span>
    );
  }

  return (
    <span
      className={`${styles.glyph} ${item.direction === 'IN' ? styles.glyphIn : styles.glyphOut}`}
      aria-hidden="true"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path
          d={item.direction === 'IN' ? 'M8 3v10M8 13l-4-4M8 13l4-4' : 'M8 13V3M8 3L4 7M8 3l4 4'}
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

/**
 * Renders `GET /activity` items — transfers and money requests the caller is
 * party to, already normalized and authorized server-side.
 *
 * A `MONEY_REQUEST` row shows a neutral (unsigned) amount: it represents the
 * ask, not a movement of money. Once accepted, the settling transfer shows up
 * as its own `TRANSFER` row with the real signed amount — the two are never
 * conflated (matches the backend's own separation of request vs. transfer).
 */
export function ActivityList({ items }: { items: readonly ActivityItem[] }): ReactElement {
  return (
    <ul className={styles.list}>
      {items.map((item) => (
        <li key={item.activityId} className={styles.row}>
          <Glyph item={item} />

          <div className={styles.body}>
            <span className={styles.title}>{titleFor(item)}</span>
            <span className={styles.sub}>
              <DateTime value={item.createdAt} mode="short" />
            </span>
          </div>

          <div className={styles.right}>
            {item.direction === 'REQUEST' ? (
              <Amount amountMinor={item.amountMinor} className={styles.amount} />
            ) : (
              <Amount
                amountMinor={item.amountMinor}
                direction={item.direction === 'IN' ? 'in' : 'out'}
                className={`${styles.amount} ${item.direction === 'IN' ? styles.amountIn : styles.amountOut}`}
              />
            )}
            <Badge tone={STATUS_TONE[item.status] ?? 'neutral'}>{item.status}</Badge>
          </div>
        </li>
      ))}
    </ul>
  );
}
