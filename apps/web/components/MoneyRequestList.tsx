'use client';

import type { ReactElement } from 'react';
import type { MoneyRequest, MoneyRequestStatus } from '../lib/api-types';
import { Amount } from './Amount';
import { Button } from './Button';
import { DateTime } from './DateTime';
import { Badge, type BadgeTone } from './Feedback';
import styles from './TransferList.module.css';

const STATUS_TONE: Record<MoneyRequestStatus, BadgeTone> = {
  PENDING: 'pending',
  ACCEPTED: 'success',
  DECLINED: 'danger',
  CANCELLED: 'neutral',
  EXPIRED: 'neutral',
};

function shortId(id: string): string {
  return `user ${id.slice(0, 8)}`;
}

function RequestGlyph(): ReactElement {
  return (
    <span className={`${styles.glyph} ${styles.glyphOut}`} aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path
          d="M3 4.5h10M3 8h10M3 11.5h6"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

/**
 * Renders one page of `GET /money-requests/incoming` or `/outgoing`.
 *
 * Neither list carries the counterparty's display name — the money-request
 * DTO only exposes `requesterUserId` / `payerUserId` (no lookup endpoint
 * exists for an arbitrary user id) — so, like TransferList's own fallback,
 * an unresolved counterparty renders as a short id rather than inventing a
 * name.
 */
export interface PendingRequestAction {
  requestId: string;
  action: 'accept' | 'decline' | 'cancel';
}

export function MoneyRequestList({
  items,
  role,
  pending,
  onAccept,
  onDecline,
  onCancel,
}: {
  items: readonly MoneyRequest[];
  /** Whose inbox this list represents: 'payer' for incoming, 'requester' for outgoing. */
  role: 'payer' | 'requester';
  /** The request+action currently in flight, so only that one button spins and every row is disabled meanwhile. */
  pending: PendingRequestAction | null;
  onAccept?: (request: MoneyRequest) => void;
  onDecline?: (request: MoneyRequest) => void;
  onCancel?: (request: MoneyRequest) => void;
}): ReactElement {
  return (
    <ul className={styles.list}>
      {items.map((request) => {
        const counterpartyId = role === 'payer' ? request.requesterUserId : request.payerUserId;
        const isRowPending = pending?.requestId === request.requestId;
        const isAccepting = isRowPending && pending?.action === 'accept';
        const isDeclining = isRowPending && pending?.action === 'decline';
        const isCancelling = isRowPending && pending?.action === 'cancel';
        const anyActionInFlight = pending !== null;
        const isPending = request.status === 'PENDING';

        return (
          <li key={request.requestId} className={styles.row}>
            <RequestGlyph />

            <div className={styles.body}>
              <span className={styles.title}>
                {role === 'payer' ? 'Requested by ' : 'Requested from '}
                {shortId(counterpartyId)}
              </span>
              <span className={styles.sub}>
                <DateTime value={request.createdAt} mode="short" />
                {request.note ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className={styles.note}>{request.note}</span>
                  </>
                ) : null}
              </span>
            </div>

            <div className={styles.right}>
              <Amount amountMinor={request.amountMinor} className={styles.amount} />
              <Badge tone={STATUS_TONE[request.status]}>{request.status}</Badge>

              {isPending && role === 'payer' ? (
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <Button
                    size="sm"
                    variant="accent"
                    isLoading={isAccepting}
                    disabled={anyActionInFlight && !isAccepting}
                    onClick={() => onAccept?.(request)}
                  >
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    isLoading={isDeclining}
                    disabled={anyActionInFlight && !isDeclining}
                    onClick={() => onDecline?.(request)}
                  >
                    Decline
                  </Button>
                </div>
              ) : null}

              {isPending && role === 'requester' ? (
                <Button
                  size="sm"
                  variant="secondary"
                  isLoading={isCancelling}
                  disabled={anyActionInFlight && !isCancelling}
                  onClick={() => onCancel?.(request)}
                  style={{ marginTop: 4 }}
                >
                  Cancel
                </Button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
