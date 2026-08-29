import type { ReactElement, ReactNode } from 'react';
import styles from './Feedback.module.css';

/* --- Alert --- */

export type AlertTone = 'error' | 'success' | 'warning' | 'info';

const ALERT_STYLES: Record<AlertTone, string> = {
  error: styles.alertError!,
  success: styles.alertSuccess!,
  warning: styles.alertWarning!,
  info: styles.alertInfo!,
};

const ALERT_MARKS: Record<AlertTone, string> = {
  error: '!',
  success: '✓',
  warning: '!',
  info: 'i',
};

export function Alert({
  tone,
  title,
  children,
}: {
  tone: AlertTone;
  title?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div
      className={`${styles.alert} ${ALERT_STYLES[tone]}`}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <span className={styles.alertMark} aria-hidden="true">
        {ALERT_MARKS[tone]}
      </span>
      <div className={styles.alertBody}>
        {title ? <span className={styles.alertTitle}>{title}</span> : null}
        <span>{children}</span>
      </div>
    </div>
  );
}

/* --- Badge --- */

export type BadgeTone = 'success' | 'neutral' | 'pending' | 'danger';

const BADGE_STYLES: Record<BadgeTone, string> = {
  success: styles.badgeSuccess!,
  neutral: styles.badgeNeutral!,
  pending: styles.badgePending!,
  danger: styles.badgeDanger!,
};

export function Badge({ tone, children }: { tone: BadgeTone; children: ReactNode }): ReactElement {
  return <span className={`${styles.badge} ${BADGE_STYLES[tone]}`}>{children}</span>;
}

/* --- Card --- */

export function Card({
  title,
  subtitle,
  action,
  children,
  className,
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <section className={[styles.card, className ?? ''].filter(Boolean).join(' ')}>
      {title || action ? (
        <header className={styles.cardHeader}>
          <div>
            {title ? <h2 className={styles.cardTitle}>{title}</h2> : null}
            {subtitle ? <p className={styles.cardSubtitle}>{subtitle}</p> : null}
          </div>
          {action}
        </header>
      ) : null}
      {children}
    </section>
  );
}

/* --- Empty state --- */

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}): ReactElement {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyGlyph} aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path
            d="M3 6.5h14M3 10h14M3 13.5h9"
            stroke="#096c35"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </span>
      <p className={styles.emptyTitle}>{title}</p>
      {description ? <p className={styles.emptyText}>{description}</p> : null}
      {action}
    </div>
  );
}

/* --- Skeleton --- */

export function Skeleton({
  height = 16,
  width = '100%',
}: {
  height?: number;
  width?: string;
}): ReactElement {
  return (
    <span
      className={styles.skeleton}
      style={{ height, width, display: 'block' }}
      aria-hidden="true"
    />
  );
}
