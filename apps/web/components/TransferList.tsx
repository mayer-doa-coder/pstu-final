'use client';

import type { ReactElement } from 'react';
import type { Transfer } from '../lib/api-types';
import { Amount } from './Amount';
import { DateTime } from './DateTime';
import { Badge, Skeleton, type BadgeTone } from './Feedback';
import styles from './TransferList.module.css';

const STATUS_TONE: Record<Transfer['status'], BadgeTone> = {
  SUCCEEDED: 'success',
  PENDING: 'pending',
  FAILED: 'danger',
};

export interface TransferListItem {
  transfer: Transfer;
  /** Resolved relative to the signed-in user. */
  direction: 'in' | 'out';
  /** Display name of the other party, when the UI has it. */
  counterpartyName?: string;
}

function ArrowGlyph({ direction }: { direction: 'in' | 'out' }): ReactElement {
  return (
    <span
      className={`${styles.glyph} ${direction === 'in' ? styles.glyphIn : styles.glyphOut}`}
      aria-hidden="true"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path
          d={direction === 'in' ? 'M8 3v10M8 13l-4-4M8 13l4-4' : 'M8 13V3M8 3L4 7M8 3l4 4'}
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export function TransferList({ items }: { items: readonly TransferListItem[] }): ReactElement {
  return (
    <ul className={styles.list}>
      {items.map(({ transfer, direction, counterpartyName }) => {
        const counterpartyId = direction === 'in' ? transfer.senderUserId : transfer.receiverUserId;

        return (
          <li key={transfer.transferId} className={styles.row}>
            <ArrowGlyph direction={direction} />

            <div className={styles.body}>
              <span className={styles.title}>
                {direction === 'in' ? 'Received from' : 'Sent to'}{' '}
                {counterpartyName ?? `user ${counterpartyId.slice(0, 8)}`}
              </span>
              <span className={styles.sub}>
                <DateTime value={transfer.createdAt} mode="short" />
                {transfer.note ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className={styles.note}>{transfer.note}</span>
                  </>
                ) : null}
              </span>
            </div>

            <div className={styles.right}>
              <Amount
                amountMinor={transfer.amountMinor}
                direction={direction}
                className={`${styles.amount} ${direction === 'in' ? styles.amountIn : styles.amountOut}`}
              />
              <Badge tone={STATUS_TONE[transfer.status]}>{transfer.status}</Badge>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function TransferListSkeleton({ rows = 3 }: { rows?: number }): ReactElement {
  return (
    <div>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className={styles.rowSkeleton}>
          <span className={styles.skeletonGlyph}>
            <Skeleton height={38} width="38px" />
          </span>
          <div className={styles.skeletonBody}>
            <Skeleton height={14} width="45%" />
            <Skeleton height={12} width="30%" />
          </div>
          <Skeleton height={16} width="90px" />
        </div>
      ))}
    </div>
  );
}
