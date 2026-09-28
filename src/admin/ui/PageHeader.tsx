import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useAdminPageMeta } from '../useAdminPageMeta';
import styles from './adminUi.module.css';

/** Page title (h1) + subtitle + page-level actions; also sets the document title. */
export function PageHeader({
  title,
  subtitle,
  actions,
  crumbs,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  crumbs?: { label: string; to: string }[];
}) {
  useAdminPageMeta(title);
  return (
    <div className={styles.header}>
      <div className={styles.headerText}>
        {crumbs && crumbs.length > 0 && (
          <nav aria-label="breadcrumb">
            <ol className={styles.crumbs}>
              {crumbs.map((c) => (
                <li key={c.to}>
                  <Link to={c.to}>{c.label}</Link>
                  <span aria-hidden="true"> /</span>
                </li>
              ))}
            </ol>
          </nav>
        )}
        <h1 className={styles.title}>{title}</h1>
        {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}

export function Panel({
  title,
  icon,
  actions,
  children,
  headingLevel = 2,
  className,
}: {
  title?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  headingLevel?: 2 | 3;
  className?: string;
}) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <section className={[styles.panel, className].filter(Boolean).join(' ')}>
      {(title || actions) && (
        <div className={styles.panelHead}>
          {title && (
            <Heading className={styles.panelTitle}>
              {icon}
              {title}
            </Heading>
          )}
          {actions && <div className={styles.actions}>{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatTile({
  label,
  value,
  hint,
  icon,
  to,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  to?: string;
  tone?: 'warn' | 'danger';
}) {
  const className = [
    styles.tile,
    tone === 'warn' && styles.tileWarn,
    tone === 'danger' && styles.tileDanger,
  ]
    .filter(Boolean)
    .join(' ');
  const body = (
    <>
      <span className={styles.tileLabel}>
        {icon}
        {label}
      </span>
      <span className={styles.tileValue}>{value}</span>
      {hint && <span className={styles.tileHint}>{hint}</span>}
    </>
  );
  return to ? (
    <Link to={to} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}
