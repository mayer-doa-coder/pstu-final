'use client';

import Link from 'next/link';
import { useRef, useState, type FormEvent, type ReactElement } from 'react';
import { Button } from '../../../components/Button';
import { TextAreaField, TextField } from '../../../components/Field';
import { Alert, Card } from '../../../components/Feedback';
import { RecipientPicker } from '../../../components/RecipientPicker';
import { ApiError, newIdempotencyKey } from '../../../lib/api-client';
import { createTransfer } from '../../../lib/api';
import type { Transfer, UserSearchResult } from '../../../lib/api-types';
import { formatBdt, parseBdtToMinor } from '../../../lib/money';
import { useSession } from '../../../lib/session-context';
import styles from './send.module.css';

type Stage = 'compose' | 'confirm' | 'done';

const QUICK_AMOUNTS = [100, 500, 1000, 5000] as const;
const MAX_NOTE_LENGTH = 280;

export default function SendMoneyPage(): ReactElement {
  const { wallet, refreshWallet } = useSession();

  const [stage, setStage] = useState<Stage>('compose');
  const [recipient, setRecipient] = useState<UserSearchResult | null>(null);
  const [amountText, setAmountText] = useState('');
  const [note, setNote] = useState('');

  const [amountError, setAmountError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<{ message: string; ambiguous: boolean } | null>(
    null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<Transfer | null>(null);

  /**
   * One idempotency key per user intent. It is minted when the user reaches the
   * confirmation screen and reused for every retry of that same transfer, so a
   * retry after a timeout replays the original receipt instead of paying twice.
   */
  const idempotencyKeyRef = useRef<string | null>(null);

  const parsed = parseBdtToMinor(amountText);
  const amountMinor = parsed.ok ? parsed.amountMinor : null;
  const isWalletUsable = wallet?.status === 'ACTIVE';

  function handleReview(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setFormError(null);

    if (!recipient) {
      setFormError('Choose who you are sending to.');
      return;
    }

    if (!parsed.ok) {
      setAmountError(parsed.message);
      return;
    }

    setAmountError(null);

    // A local affordability hint only — the authoritative check happens inside
    // the database lock on the server, and the balance can change before then.
    if (wallet && parsed.amountMinor > wallet.balanceMinor) {
      setFormError(
        `That is more than your available balance of ${formatBdt(wallet.balanceMinor)}.`,
      );
      return;
    }

    idempotencyKeyRef.current = newIdempotencyKey();
    setSubmitError(null);
    setStage('confirm');
  }

  async function handleConfirm(): Promise<void> {
    if (isSubmitting || !recipient || amountMinor === null) {
      return;
    }

    const idempotencyKey = idempotencyKeyRef.current;
    if (!idempotencyKey) {
      setSubmitError({
        message: 'Something went wrong. Start the transfer again.',
        ambiguous: false,
      });
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const transfer = await createTransfer(
        {
          receiverUserId: recipient.id,
          amountMinor,
          ...(note.trim() ? { note: note.trim() } : {}),
        },
        idempotencyKey,
      );

      setReceipt(transfer);
      setStage('done');
      void refreshWallet();
    } catch (cause) {
      const isApiError = cause instanceof ApiError;
      setSubmitError({
        message: isApiError ? cause.message : 'The transfer could not be completed.',
        ambiguous: isApiError && cause.isAmbiguous,
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  function resetForAnother(): void {
    idempotencyKeyRef.current = null;
    setStage('compose');
    setRecipient(null);
    setAmountText('');
    setNote('');
    setReceipt(null);
    setSubmitError(null);
    setFormError(null);
    setAmountError(null);
  }

  return (
    <>
      <header className={styles.header}>
        <h1 className={styles.title}>Send money</h1>
        <p className={styles.subtitle}>
          Find the person, enter the amount, and review before anything moves.
        </p>
      </header>

      <div className={styles.layout}>
        <Card>
          <Stepper stage={stage} />

          {stage === 'compose' ? (
            <form className={styles.form} onSubmit={handleReview} noValidate>
              {!isWalletUsable && wallet ? (
                <Alert tone="warning" title="Wallet unavailable">
                  Your wallet is {wallet.status.toLowerCase()}, so you cannot send money right now.
                </Alert>
              ) : null}

              {formError ? <Alert tone="error">{formError}</Alert> : null}

              <RecipientPicker
                selected={recipient}
                onSelect={(next) => {
                  setRecipient(next);
                  setFormError(null);
                }}
              />

              <div>
                <div className={styles.amountWrap}>
                  <TextField
                    label="Amount"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={amountText}
                    onChange={(event) => {
                      setAmountText(event.target.value);
                      setAmountError(null);
                      setFormError(null);
                    }}
                    className={styles.amountInput}
                    error={amountError}
                    hint={
                      wallet
                        ? `Available: ${formatBdt(wallet.balanceMinor)}`
                        : 'Loading your balance…'
                    }
                    autoComplete="off"
                  />
                  <span className={styles.currencyMark} aria-hidden="true">
                    &#2547;
                  </span>
                </div>

                <div className={styles.quickRow} style={{ marginTop: 'var(--space-3)' }}>
                  {QUICK_AMOUNTS.map((value) => (
                    <Button
                      key={value}
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setAmountText(value.toFixed(2));
                        setAmountError(null);
                        setFormError(null);
                      }}
                    >
                      &#2547;
                      {value.toLocaleString('en-US')}
                    </Button>
                  ))}
                </div>
              </div>

              <TextAreaField
                label="Note"
                optional
                placeholder="What is this for?"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={MAX_NOTE_LENGTH}
                hint={`${note.length}/${MAX_NOTE_LENGTH} characters`}
              />

              <Button type="submit" variant="primary" fullWidth disabled={!isWalletUsable}>
                Review transfer
              </Button>
            </form>
          ) : null}

          {stage === 'confirm' && recipient && amountMinor !== null ? (
            <div>
              <h2 style={{ fontSize: 17 }}>Confirm this transfer</h2>
              <p className={styles.subtitle} style={{ marginBottom: 'var(--space-3)' }}>
                Money moves as soon as you confirm. Check the details carefully.
              </p>

              {submitError ? (
                <Alert
                  tone={submitError.ambiguous ? 'warning' : 'error'}
                  title={submitError.ambiguous ? 'Outcome not confirmed' : 'Transfer failed'}
                >
                  {submitError.message}
                  {submitError.ambiguous
                    ? ' Retrying is safe — this transfer carries an idempotency key, so it can only be applied once.'
                    : null}
                </Alert>
              ) : null}

              <div className={styles.confirmList}>
                <div className={styles.confirmRow}>
                  <span className={styles.confirmLabel}>To</span>
                  <span className={styles.confirmValue}>
                    {recipient.displayName}
                    <br />
                    <span style={{ fontWeight: 400, color: 'var(--ink-faint)', fontSize: 13 }}>
                      {recipient.maskedEmail}
                    </span>
                  </span>
                </div>

                {note.trim() ? (
                  <div className={styles.confirmRow}>
                    <span className={styles.confirmLabel}>Note</span>
                    <span className={styles.confirmValue}>{note.trim()}</span>
                  </div>
                ) : null}

                <div className={`${styles.confirmRow} ${styles.confirmTotal}`}>
                  <span className={styles.confirmLabel}>Amount</span>
                  <span className={`${styles.confirmTotalValue} tabular`}>
                    {formatBdt(amountMinor)}
                  </span>
                </div>
              </div>

              <div className={styles.confirmActions}>
                <Button
                  variant="accent"
                  onClick={() => void handleConfirm()}
                  isLoading={isSubmitting}
                >
                  {isSubmitting ? 'Sending…' : `Send ${formatBdt(amountMinor)}`}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setStage('compose');
                    setSubmitError(null);
                  }}
                  disabled={isSubmitting}
                >
                  Back
                </Button>
              </div>
            </div>
          ) : null}

          {stage === 'done' && receipt ? (
            <div>
              <div className={styles.receiptTop}>
                <span className={styles.receiptMark} aria-hidden="true">
                  ✓
                </span>
                <p className={`${styles.receiptAmount} tabular`}>
                  {formatBdt(receipt.amountMinor)}
                </p>
                <p className={styles.receiptCaption}>
                  Sent to {recipient?.displayName ?? 'your recipient'}
                </p>
              </div>

              <div className={styles.confirmList}>
                <div className={styles.confirmRow}>
                  <span className={styles.confirmLabel}>Status</span>
                  <span className={styles.confirmValue}>{receipt.status}</span>
                </div>
                <div className={styles.confirmRow}>
                  <span className={styles.confirmLabel}>Transfer ID</span>
                  <span className={`${styles.confirmValue} ${styles.receiptId}`}>
                    {receipt.transferId}
                  </span>
                </div>
                {receipt.senderBalanceAfterMinor !== undefined ? (
                  <div className={`${styles.confirmRow} ${styles.confirmTotal}`}>
                    <span className={styles.confirmLabel}>New balance</span>
                    <span className={`${styles.confirmValue} tabular`}>
                      {formatBdt(receipt.senderBalanceAfterMinor)}
                    </span>
                  </div>
                ) : null}
              </div>

              <div className={styles.confirmActions}>
                <Button variant="primary" onClick={resetForAnother}>
                  Send another
                </Button>
                <Link href="/activity">
                  <Button variant="secondary">View activity</Button>
                </Link>
              </div>
            </div>
          ) : null}
        </Card>

        <Card title="How this transfer is protected">
          <p className={styles.sideNote}>
            <strong>It is all-or-nothing.</strong> The debit and the credit happen inside one
            database transaction. If any part fails, the whole thing rolls back and no balance
            changes.
          </p>
          <p className={styles.sideNote}>
            <strong>Retrying is safe.</strong> Each transfer carries a unique idempotency key. If
            you retry after a timeout, the server replays the original result instead of sending the
            money a second time.
          </p>
          <p className={styles.sideNote}>
            <strong>Your balance is checked twice.</strong> The amount is validated here for
            convenience, then re-checked against your live balance while your wallet is locked on
            the server — so a balance change between screens cannot cause an overdraft.
          </p>
        </Card>
      </div>
    </>
  );
}

function Stepper({ stage }: { stage: Stage }): ReactElement {
  const steps: Array<{ key: Stage; label: string }> = [
    { key: 'compose', label: 'Details' },
    { key: 'confirm', label: 'Review' },
    { key: 'done', label: 'Receipt' },
  ];
  const currentIndex = steps.findIndex((step) => step.key === stage);

  return (
    <div className={styles.steps}>
      {steps.map((step, index) => (
        <span key={step.key} style={{ display: 'contents' }}>
          <span
            className={[
              styles.step,
              index === currentIndex ? styles.stepActive : '',
              index < currentIndex ? styles.stepDone : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <span className={styles.stepMark} aria-hidden="true">
              {index < currentIndex ? '✓' : index + 1}
            </span>
            {step.label}
          </span>
          {index < steps.length - 1 ? <span className={styles.stepBar} aria-hidden="true" /> : null}
        </span>
      ))}
    </div>
  );
}
