'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { AuthLayout } from '../AuthLayout';
import { Button } from '../../../components/Button';
import { TextField } from '../../../components/Field';
import { Alert } from '../../../components/Feedback';
import { ApiError } from '../../../lib/api-client';
import { register } from '../../../lib/api';
import { useSession } from '../../../lib/session-context';
import styles from '../auth.module.css';

const MIN_PASSWORD_LENGTH = 8;

export default function RegisterPage(): ReactElement {
  const router = useRouter();
  const { status, refreshSession } = useSession();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (status === 'authenticated') {
      router.replace('/dashboard');
    }
  }, [status, router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      setPasswordError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }

    setPasswordError(null);
    setError(null);
    setIsSubmitting(true);

    try {
      await register({
        email: email.trim(),
        password,
        displayName: displayName.trim(),
      });
      await refreshSession();
      router.replace('/dashboard');
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : 'Could not create your account. Please try again.',
      );
      setIsSubmitting(false);
    }
  }

  return (
    <AuthLayout
      eyebrow="Get started"
      title="Open your"
      titleAccent="wallet"
      subtitle="Registering creates your account and an active BDT wallet in one step."
      footer={
        <>
          Already have an account?{' '}
          <Link href="/login" className={styles.switchLink}>
            Sign in
          </Link>
        </>
      }
    >
      <form className={styles.form} onSubmit={(event) => void handleSubmit(event)} noValidate>
        {error ? (
          <Alert tone="error" title="Registration failed">
            {error}
          </Alert>
        ) : null}

        <TextField
          label="Display name"
          name="displayName"
          autoComplete="name"
          placeholder="Your name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          maxLength={120}
          required
          disabled={isSubmitting}
          hint="This is how other people will find and recognise you."
        />

        <TextField
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          maxLength={254}
          required
          disabled={isSubmitting}
        />

        <TextField
          label="Password"
          type="password"
          name="password"
          autoComplete="new-password"
          placeholder="At least 8 characters"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            if (passwordError) {
              setPasswordError(null);
            }
          }}
          minLength={MIN_PASSWORD_LENGTH}
          maxLength={128}
          required
          disabled={isSubmitting}
          error={passwordError}
        />

        <Button type="submit" variant="primary" fullWidth isLoading={isSubmitting}>
          {isSubmitting ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
    </AuthLayout>
  );
}
