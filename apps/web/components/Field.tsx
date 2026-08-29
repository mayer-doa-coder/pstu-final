'use client';

import { useId, type InputHTMLAttributes, type ReactElement, type TextareaHTMLAttributes } from 'react';
import styles from './Field.module.css';

interface CommonProps {
  label: string;
  hint?: string;
  error?: string | null;
  optional?: boolean;
}

type TextFieldProps = CommonProps & Omit<InputHTMLAttributes<HTMLInputElement>, 'id'>;

export function TextField({
  label,
  hint,
  error,
  optional = false,
  className,
  ...rest
}: TextFieldProps): ReactElement {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
        {optional ? <span className={styles.optional}> · optional</span> : null}
      </label>
      <input
        {...rest}
        id={id}
        className={[styles.input, error ? styles.invalid : '', className ?? '']
          .filter(Boolean)
          .join(' ')}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : hint ? hintId : undefined}
      />
      {error ? (
        <p className={styles.error} id={errorId}>
          {error}
        </p>
      ) : hint ? (
        <p className={styles.hint} id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type TextAreaFieldProps = CommonProps & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'>;

export function TextAreaField({
  label,
  hint,
  error,
  optional = false,
  className,
  ...rest
}: TextAreaFieldProps): ReactElement {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
        {optional ? <span className={styles.optional}> · optional</span> : null}
      </label>
      <textarea
        {...rest}
        id={id}
        className={[styles.textarea, error ? styles.invalid : '', className ?? '']
          .filter(Boolean)
          .join(' ')}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : hint ? hintId : undefined}
      />
      {error ? (
        <p className={styles.error} id={errorId}>
          {error}
        </p>
      ) : hint ? (
        <p className={styles.hint} id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
