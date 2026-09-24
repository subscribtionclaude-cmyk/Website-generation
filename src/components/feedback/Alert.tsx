import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import styles from './feedback.module.css';

type Tone = 'info' | 'success' | 'warning' | 'danger';

const ICONS = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
} as const;

/** Inline message. Tone is conveyed by icon + text, never by colour alone. */
export function Alert({
  tone = 'info',
  title,
  children,
  action,
  live = false,
}: {
  tone?: Tone;
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
  /** Announce to screen readers when it appears (errors after an action). */
  live?: boolean;
}) {
  const Icon = ICONS[tone];
  return (
    <div
      className={[styles.alert, styles[tone]].join(' ')}
      role={live ? (tone === 'danger' ? 'alert' : 'status') : undefined}
    >
      <Icon aria-hidden="true" />
      <div className={styles.alertBody}>
        {title && <p className={styles.alertTitle}>{title}</p>}
        {children && <div>{children}</div>}
      </div>
      {action && <div className={styles.alertAction}>{action}</div>}
    </div>
  );
}
