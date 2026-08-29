'use client';

/** Loads a page of the caller's real activity feed from GET /activity, with cursor "load more". */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './api-client';
import { listActivity } from './api';
import type { ActivityItem, ActivityType } from './api-types';

const DEFAULT_LIMIT = 15;

interface ActivityState {
  items: ActivityItem[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  reload: () => void;
  loadMore: () => Promise<void>;
}

export function useActivity(params: { type?: ActivityType; limit?: number } = {}): ActivityState {
  const { type, limit = DEFAULT_LIMIT } = params;

  const [items, setItems] = useState<ActivityItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const nextCursorRef = useRef<string | null>(null);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);

    listActivity({ type, limit }, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) {
          return;
        }
        setItems(page.items);
        setNextCursor(page.nextCursor);
        nextCursorRef.current = page.nextCursor;
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setError(cause instanceof ApiError ? cause.message : 'Could not load your activity.');
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [type, limit, reloadToken]);

  const loadMore = useCallback(async () => {
    const cursor = nextCursorRef.current;
    if (!cursor || isLoadingMore) {
      return;
    }

    setIsLoadingMore(true);
    try {
      const page = await listActivity({ type, cursor, limit });
      setItems((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
      nextCursorRef.current = page.nextCursor;
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not load more activity.');
    } finally {
      setIsLoadingMore(false);
    }
  }, [type, limit, isLoadingMore]);

  return { items, isLoading, isLoadingMore, hasMore: nextCursor !== null, error, reload, loadMore };
}
