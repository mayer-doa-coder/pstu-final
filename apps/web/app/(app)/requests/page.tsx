'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { Button } from '../../../components/Button';
import { TextAreaField, TextField } from '../../../components/Field';
import { Alert, Card, EmptyState } from '../../../components/Feedback';
import { MoneyRequestList, type PendingRequestAction } from '../../../components/MoneyRequestList';
import { TransferListSkeleton } from '../../../components/TransferList';
import { RecipientPicker } from '../../../components/RecipientPicker';
import { ApiError, newIdempotencyKey } from '../../../lib/api-client';
import {
  acceptMoneyRequest,
  cancelMoneyRequest,
  createMoneyRequest,
  declineMoneyRequest,
  listIncomingRequests,
  listOutgoingRequests,
} from '../../../lib/api';
import type { MoneyRequest, UserSearchResult } from '../../../lib/api-types';
import { parseBdtToMinor } from '../../../lib/money';
import styles from '../page-header.module.css';

type Tab = 'incoming' | 'outgoing';

const MAX_NOTE_LENGTH = 280;
const LIST_LIMIT = 20;

export default function RequestsPage(): ReactElement {
  const [tab, setTab] = useState<Tab>('incoming');
  const [incoming, setIncoming] = useState<MoneyRequest[]>([]);
  const [outgoing, setOutgoing] = useState<MoneyRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [isComposing, setIsComposing] = useState(false);
  const [payer, setPayer] = useState<UserSearchResult | null>(null);
  const [amountText, setAmountText] = useState('');
  const [note, setNote] = useState('');
  const [amountError, setAmountError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  /**
   * One idempotency key per request intent — minted lazily on first submit
   * and reused across retries of that same attempt, so a retry after a
   * dropped response cannot create a second request. Any field edit clears
   * it, since an edited form is a new intent (and reusing a stale key against
   * a changed payload would otherwise be rejected as IDEMPOTENCY_KEY_REUSED).
   */
  const idempotencyKeyRef = useRef<string | null>(null);

  const [pendingAction, setPendingAction] = useState<PendingRequestAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setListError(null);

    Promise.all([
      listIncomingRequests({ limit: LIST_LIMIT }, controller.signal),
      listOutgoingRequests({ limit: LIST_LIMIT }, controller.signal),
    ])
      .then(([incomingPage, outgoingPage]) => {
        if (controller.signal.aborted) {
          return;
        }
        setIncoming(incomingPage.items);
        setOutgoing(outgoingPage.items);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setListError(cause instanceof ApiError ? cause.message : 'Could not load your requests.');
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [reloadToken]);

  function resetComposeForm(): void {
    setPayer(null);
    setAmountText('');
    setNote('');
    setAmountError(null);
    setFormError(null);
    idempotencyKeyRef.current = null;
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);

    if (!payer) {
      setFormError('Choose who you are requesting from.');
      return;
    }

    const parsed = parseBdtToMinor(amountText);
    if (!parsed.ok) {
      setAmountError(parsed.message);
      return;
    }
    setAmountError(null);

    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = newIdempotencyKey();
    }

    setIsSubmitting(true);
    try {
      await createMoneyRequest(
        {
          payerUserId: payer.id,
          amountMinor: parsed.amountMinor,
          ...(note.trim() ? { note: note.trim() } : {}),
        },
        idempotencyKeyRef.current,
      );

      setIsComposing(false);
      resetComposeForm();
      setTab('outgoing');
      reload();
    } catch (cause) {
      setFormError(cause instanceof ApiError ? cause.message : 'Could not send that request.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function runAction(
    request: MoneyRequest,
    action: PendingRequestAction['action'],
    call: (id: string, key: string) => Promise<MoneyRequest>,
  ): Promise<void> {
    if (pendingAction) {
      return;
    }

    setPendingAction({ requestId: request.requestId, action });
    setActionError(null);
    try {
      await call(request.requestId, newIdempotencyKey());
      reload();
    } catch (cause) {
      setActionError(
        cause instanceof ApiError ? cause.message : 'That action could not be completed.',
      );
    } finally {
      setPendingAction(null);
    }
  }

  const visible = tab === 'incoming' ? incoming : outgoing;
  const incomingPendingCount = incoming.filter((request) => request.status === 'PENDING').length;

  return (
    <div className={styles.stack}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Money requests</h1>
          <p className={styles.subtitle}>
            Ask someone to pay you, and review the requests waiting on you.
          </p>
        </div>
        <Button
          variant="accent"
          onClick={() => {
            if (isComposing) {
              resetComposeForm();
            }
            setIsComposing((open) => !open);
          }}
        >
          {isComposing ? 'Cancel' : 'New request'}
        </Button>
      </header>

      {isComposing ? (
        <Card title="Request money">
          <form
            onSubmit={(event) => void handleCreate(event)}
            noValidate
            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
          >
            {formError ? <Alert tone="error">{formError}</Alert> : null}

            <RecipientPicker
              selected={payer}
              disabled={isSubmitting}
              onSelect={(next) => {
                setPayer(next);
                setFormError(null);
                idempotencyKeyRef.current = null;
              }}
            />

            <TextField
              label="Amount"
              inputMode="decimal"
              placeholder="0.00"
              value={amountText}
              disabled={isSubmitting}
              onChange={(event) => {
                setAmountText(event.target.value);
                setAmountError(null);
                setFormError(null);
                idempotencyKeyRef.current = null;
              }}
              error={amountError}
              autoComplete="off"
            />

            <TextAreaField
              label="Note"
              optional
              placeholder="What is this for?"
              value={note}
              disabled={isSubmitting}
              onChange={(event) => {
                setNote(event.target.value);
                idempotencyKeyRef.current = null;
              }}
              maxLength={MAX_NOTE_LENGTH}
              hint={`${note.length}/${MAX_NOTE_LENGTH} characters`}
            />

            <Button type="submit" variant="primary" isLoading={isSubmitting}>
              Send request
            </Button>
          </form>
        </Card>
      ) : null}

      <Card>
        <div className={styles.tabs} role="tablist" aria-label="Filter requests">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'incoming'}
            className={`${styles.tab} ${tab === 'incoming' ? styles.tabActive : ''}`}
            onClick={() => setTab('incoming')}
          >
            Incoming{incomingPendingCount > 0 ? ` (${incomingPendingCount})` : ''}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'outgoing'}
            className={`${styles.tab} ${tab === 'outgoing' ? styles.tabActive : ''}`}
            onClick={() => setTab('outgoing')}
          >
            Outgoing
          </button>
        </div>

        {listError ? <Alert tone="warning">{listError}</Alert> : null}
        {actionError ? <Alert tone="error">{actionError}</Alert> : null}

        {isLoading ? (
          <TransferListSkeleton rows={3} />
        ) : visible.length === 0 ? (
          <EmptyState
            title={
              tab === 'incoming'
                ? 'No one has requested money from you'
                : 'You have not requested any money'
            }
            description={
              tab === 'incoming'
                ? 'Requests other people send you will show up here.'
                : 'Use "New request" to ask someone to pay you.'
            }
            action={
              tab === 'outgoing' ? (
                <Button variant="accent" size="sm" onClick={() => setIsComposing(true)}>
                  New request
                </Button>
              ) : undefined
            }
          />
        ) : (
          <MoneyRequestList
            items={visible}
            role={tab === 'incoming' ? 'payer' : 'requester'}
            pending={pendingAction}
            onAccept={(request) => void runAction(request, 'accept', acceptMoneyRequest)}
            onDecline={(request) => void runAction(request, 'decline', declineMoneyRequest)}
            onCancel={(request) => void runAction(request, 'cancel', cancelMoneyRequest)}
          />
        )}
      </Card>
    </div>
  );
}
