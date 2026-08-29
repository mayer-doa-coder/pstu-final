'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { AuthLayout } from '../AuthLayout';
import { Button } from '../../../components/Button';
import { TextField } from '../../../components/Field';
import { Alert } from '../../../components/Feedback';
import { ApiError } from '../../../lib/api-client';
import { login } from '../../../lib/api';
import { useSession } from '../../../lib/session-context';
import styles from '../auth.module.css';

export default function LoginPage(): ReactElement {
  const router = useRouter();
  const { status, refreshSession } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
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

    setError(null);
    setIsSubmitting(true);

    try {
      await login({ email: email.trim(), password });
      await refreshSession();
      router.replace('/dashboard');
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : 'Could not sign in. Please try again.',
      );
      setIsSubmitting(false);
    }
  }

  return (
    <AuthLayout
      eyebrow="Welcome back"
      title="Sign in to"
      titleAccent="your wallet"
      subtitle="Use the email and password you registered with."
      footer={
        <>
          New here?{' '}
          <Link href="/register" className={styles.switchLink}>
            Create an account
          </Link>
        </>
      }
    >
      <form className={styles.form} onSubmit={(event) => void handleSubmit(event)} noValidate>
        {error ? (
          <Alert tone="error" title="Sign in failed">
            {error}
          </Alert>
        ) : null}

        <TextField
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          disabled={isSubmitting}
        />

        <TextField
          label="Password"
          type="password"
          name="password"
          autoComplete="current-password"
          placeholder="Your password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          disabled={isSubmitting}
        />

        <Button type="submit" variant="primary" fullWidth isLoading={isSubmitting}>
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthLayout>
  );
}
