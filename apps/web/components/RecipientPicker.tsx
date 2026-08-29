'use client';

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { ApiError } from '../lib/api-client';
import { searchUsers } from '../lib/api';
import type { UserSearchResult } from '../lib/api-types';
import { TextField } from './Field';
import { Alert, EmptyState, Skeleton } from './Feedback';
import { Button } from './Button';
import styles from './RecipientPicker.module.css';

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 300;

function initials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] ?? '?'}${parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''}`.toUpperCase();
}

/**
 * Debounced recipient search over GET /users/search.
 *
 * Results carry only a masked email — the API never exposes another user's
 * full address or balance, and this component must not try to enrich them.
 */
export function RecipientPicker({
  selected,
  onSelect,
  disabled = false,
}: {
  selected: UserSearchResult | null;
  onSelect: (recipient: UserSearchResult | null) => void;
  disabled?: boolean;
}): ReactElement {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const trimmed = query.trim();
  const isQueryTooShort = trimmed.length > 0 && trimmed.length < MIN_QUERY_LENGTH;

  useEffect(() => {
    if (selected || trimmed.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setNextCursor(null);
      setHasSearched(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;

    const timer = setTimeout(() => {
      setIsSearching(true);
      setError(null);

      searchUsers({ q: trimmed }, controller.signal)
        .then((page) => {
          setResults(page.items);
          setNextCursor(page.nextCursor);
          setHasSearched(true);
        })
        .catch((cause: unknown) => {
          if (cause instanceof DOMException && cause.name === 'AbortError') {
            return;
          }
          setResults([]);
          setNextCursor(null);
          setError(cause instanceof ApiError ? cause.message : 'Search failed. Try again.');
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setIsSearching(false);
          }
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, selected]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || isLoadingMore) {
      return;
    }

    setIsLoadingMore(true);
    try {
      const page = await searchUsers({ q: trimmed, cursor: nextCursor });
      setResults((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not load more results.');
    } finally {
      setIsLoadingMore(false);
    }
  }, [nextCursor, isLoadingMore, trimmed]);

  if (selected) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.selected}>
          <span className={styles.avatar} aria-hidden="true">
            {initials(selected.displayName)}
          </span>
          <div className={styles.selectedBody}>
            <span className={styles.selectedLabel}>Sending to</span>
            <span className={styles.resultName}>{selected.displayName}</span>
            <span className={styles.resultEmail}>{selected.maskedEmail}</span>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              onSelect(null);
              setQuery('');
            }}
            disabled={disabled}
            style={{ marginLeft: 'auto' }}
          >
            Change
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      <TextField
        label="Recipient"
        placeholder="Search by name or email"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        autoComplete="off"
        disabled={disabled}
        error={isQueryTooShort ? `Type at least ${MIN_QUERY_LENGTH} characters to search.` : null}
        hint="Search finds other people on this platform. Balances are never shown."
      />

      {error ? <Alert tone="error">{error}</Alert> : null}

      {isSearching ? (
        <div className={styles.skeletons}>
          <Skeleton height={18} width="55%" />
          <Skeleton height={18} width="72%" />
          <Skeleton height={18} width="46%" />
        </div>
      ) : null}

      {!isSearching && hasSearched && results.length === 0 && !error ? (
        <EmptyState
          title="No one matched that search"
          description="Check the spelling, or try their full email address."
        />
      ) : null}

      {!isSearching && results.length > 0 ? (
        <ul className={styles.results} role="listbox" aria-label="Search results">
          {results.map((result) => (
            <li key={result.id}>
              <button
                type="button"
                className={styles.result}
                onClick={() => onSelect(result)}
                disabled={disabled}
              >
                <span className={styles.avatar} aria-hidden="true">
                  {initials(result.displayName)}
                </span>
                <span className={styles.resultBody}>
                  <span className={styles.resultName}>{result.displayName}</span>
                  <span className={styles.resultEmail}>{result.maskedEmail}</span>
                </span>
              </button>
            </li>
          ))}
          {nextCursor ? (
            <li>
              <button
                type="button"
                className={styles.loadMore}
                onClick={() => void loadMore()}
                disabled={isLoadingMore}
              >
                {isLoadingMore ? 'Loading…' : 'Load more results'}
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
