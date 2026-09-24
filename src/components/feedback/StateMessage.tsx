import type { ReactNode } from 'react';
import styles from './feedback.module.css';

interface StateMessageProps {
  icon: ReactNode;
  title: string;
  body?: ReactNode;
  actions?: ReactNode;
  /** Heading level to keep the document outline valid where the state is rendered. */
  headingLevel?: 1 | 2 | 3;
  role?: 'status' | 'alert';
}

/** Shared layout for empty, error, unauthorized and "coming soon" states — always offers next actions. */
export function StateMessage({
  icon,
  title,
  body,
  actions,
  headingLevel = 2,
  role,
}: StateMessageProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <section className={styles.state} role={role}>
      <div className={styles.stateIcon} aria-hidden="true">
        {icon}
      </div>
      <Heading className={styles.stateTitle}>{title}</Heading>
      {body && <p className={styles.stateBody}>{body}</p>}
      {actions && <div className={styles.stateActions}>{actions}</div>}
    </section>
  );
}
