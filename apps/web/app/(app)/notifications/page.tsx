'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactElement } from 'react';
import { Button } from '../../../components/Button';
import { DateTime } from '../../../components/DateTime';
import { Alert, Card, EmptyState } from '../../../components/Feedback';
import { TransferListSkeleton } from '../../../components/TransferList';
import { ApiError } from '../../../lib/api-client';
import { listNotifications, markNotificationRead } from '../../../lib/api';
import type { AppNotification } from '../../../lib/api-types';
import headerStyles from '../page-header.module.css';
import styles from './notifications.module.css';

const PAGE_SIZE = 20;

/** Where "View" should send the user for a notification's underlying resource. */
function linkFor(notification: AppNotification): string | null {
  if (notification.resourceType === 'transfer') {
    return '/activity';
  }
  if (notification.resourceType === 'money_request') {
    return '/requests';
  }
  return null;
}

export default function NotificationsPage(): ReactElement {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);

    listNotifications({ unreadOnly, limit: PAGE_SIZE }, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) {
          return;
        }
        setNotifications(page.items);
        setNextCursor(page.nextCursor);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setError(cause instanceof ApiError ? cause.message : 'Could not load your notifications.');
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [unreadOnly, reloadToken]);

  async function loadMore(): Promise<void> {
    if (!nextCursor || isLoadingMore) {
      return;
    }

    setIsLoadingMore(true);
    try {
      const page = await listNotifications({ unreadOnly, cursor: nextCursor, limit: PAGE_SIZE });
      setNotifications((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not load more notifications.');
    } finally {
      setIsLoadingMore(false);
    }
  }

  async function handleMarkRead(notification: AppNotification): Promise<void> {
    if (notification.readAt || markingId) {
      return;
    }

    setMarkingId(notification.notificationId);
    setError(null);
    try {
      const updated = await markNotificationRead(notification.notificationId);
      setNotifications((current) =>
        current.map((item) => (item.notificationId === updated.notificationId ? updated : item)),
      );
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not mark that as read.');
    } finally {
      setMarkingId(null);
    }
  }

  const unreadCount = notifications.filter((item) => !item.readAt).length;

  return (
    <div className={headerStyles.stack}>
      <header className={headerStyles.header}>
        <div>
          <h1 className={headerStyles.title}>Notifications</h1>
          <p className={headerStyles.subtitle}>
            Updates about money arriving, requests, and account activity.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setReloadToken((token) => token + 1)}
          isLoading={isLoading}
        >
          Refresh
        </Button>
      </header>

      <Card>
        <div className={headerStyles.tabs} role="tablist" aria-label="Filter notifications">
          <button
            type="button"
            role="tab"
            aria-selected={!unreadOnly}
            className={`${headerStyles.tab} ${!unreadOnly ? headerStyles.tabActive : ''}`}
            onClick={() => setUnreadOnly(false)}
          >
            All
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={unreadOnly}
            className={`${headerStyles.tab} ${unreadOnly ? headerStyles.tabActive : ''}`}
            onClick={() => setUnreadOnly(true)}
          >
            Unread{!unreadOnly && unreadCount > 0 ? ` (${unreadCount})` : ''}
          </button>
        </div>

        {error ? <Alert tone="warning">{error}</Alert> : null}

        {isLoading ? (
          <TransferListSkeleton rows={4} />
        ) : notifications.length === 0 ? (
          <EmptyState
            title={unreadOnly ? 'No unread notifications' : 'No notifications yet'}
            description="Money arriving, requests, and account updates will show up here."
          />
        ) : (
          <ul className={styles.list}>
            {notifications.map((notification) => {
              const href = linkFor(notification);
              const isRead = notification.readAt !== null;

              return (
                <li key={notification.notificationId} className={styles.row}>
                  <span
                    className={`${styles.dot} ${isRead ? styles.dotRead : ''}`}
                    aria-hidden="true"
                  />

                  <div className={styles.body}>
                    <span className={`${styles.title} ${isRead ? styles.titleRead : ''}`}>
                      {notification.title}
                    </span>
                    <span className={styles.text}>{notification.body}</span>
                    <span className={styles.meta}>
                      <DateTime value={notification.createdAt} mode="short" />
                      {href ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <Link href={href}>View</Link>
                        </>
                      ) : null}
                    </span>
                  </div>

                  {!isRead ? (
                    <div className={styles.actions}>
                      <Button
                        size="sm"
                        variant="secondary"
                        isLoading={markingId === notification.notificationId}
                        onClick={() => void handleMarkRead(notification)}
                      >
                        Mark read
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        {nextCursor ? (
          <div style={{ marginTop: 'var(--space-4)', textAlign: 'center' }}>
            <Button variant="secondary" onClick={() => void loadMore()} isLoading={isLoadingMore}>
              Load more
            </Button>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
