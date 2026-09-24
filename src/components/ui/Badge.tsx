import type { ReactNode } from 'react';
import styles from './ui.module.css';

export type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'inverse';

export function Badge({
  tone = 'neutral',
  icon,
  children,
}: {
  tone?: BadgeTone;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <span
      className={[styles.badge, tone !== 'neutral' && styles[`badge-${tone}`]]
        .filter(Boolean)
        .join(' ')}
    >
      {icon}
      {children}
    </span>
  );
}
