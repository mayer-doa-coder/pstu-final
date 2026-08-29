'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { ApiError } from '../lib/api-client';
import { submitNid } from '../lib/api';
import { useSession } from '../lib/session-context';
import type { VerificationStatus } from '../lib/api-types';
import { Button } from './Button';
import { TextField } from './Field';
import { Alert, Badge, type BadgeTone } from './Feedback';
import styles from './VerificationPanel.module.css';

const STATUS_TONE: Record<VerificationStatus, BadgeTone> = {
  VERIFIED: 'success',
  UNVERIFIED: 'neutral',
  REJECTED: 'danger',
};

const STATUS_LABEL: Record<VerificationStatus, string> = {
  VERIFIED: 'VERIFIED',
  UNVERIFIED: 'Not verified',
  REJECTED: 'Verification failed',
};

/**
 * Simulated NID/KYC verification: shows the account's current badge, and —
 * whenever it isn't VERIFIED yet — a small inline form to submit one.
 *
 * VERIFIED is the only terminal state on the server, so this stays mounted
 * showing the masked NID once reached; REJECTED and UNVERIFIED both keep
 * showing the form, since a rejected attempt may legitimately be retried.
 */
export function VerificationPanel(): ReactElement | null {
  const { user, refreshSession } = useSession();
  const [nidNumber, setNidNumber] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!user) {
    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }

    setError(null);
    setIsSubmitting(true);
    try {
      await submitNid(nidNumber.trim());
      setNidNumber('');
      // Re-reads /users/me, so the badge here — and anywhere else the
      // session is shown — reflects the server's verdict immediately.
      await refreshSession();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not verify that NID.');
    } finally {
      setIsSubmitting(false);
    }
  }

  const status = user.verificationStatus;

  return (
    <div className={styles.panel}>
      <div className={styles.top}>
        <span className={styles.summary}>NID / KYC verification</span>
        <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
      </div>

      {status === 'VERIFIED' ? (
        <p className={styles.masked}>NID {user.nidMasked}</p>
      ) : (
        <form className={styles.form} onSubmit={(event) => void handleSubmit(event)} noValidate>
          {status === 'REJECTED' ? (
            <Alert tone="warning">
              Your last submission could not be verified. Double-check the number and try again.
            </Alert>
          ) : null}
          {error ? <Alert tone="error">{error}</Alert> : null}

          <div className={styles.inputRow}>
            <TextField
              label="NID number"
              placeholder="10 or 17 digits"
              value={nidNumber}
              onChange={(event) => setNidNumber(event.target.value)}
              disabled={isSubmitting}
              autoComplete="off"
              inputMode="numeric"
            />
            <Button type="submit" variant="accent" size="sm" isLoading={isSubmitting}>
              Verify
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
