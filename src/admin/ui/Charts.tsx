import { useId, type ReactNode } from 'react';
import { useAdminI18n } from '../i18n/context';
import styles from './adminUi.module.css';

export interface ChartPoint {
  label: string;
  value: number;
  display: string;
}

/**
 * Dependency-free column chart. The bars are decorative; the same numbers are always available
 * as a real table (screen readers, keyboard users, and anyone who wants exact values).
 */
export function ColumnChart({ points, caption }: { points: ChartPoint[]; caption: string }) {
  const { at } = useAdminI18n();
  const id = useId();
  const max = Math.max(1, ...points.map((p) => p.value));
  return (
    <figure className={styles.figure} aria-labelledby={`${id}-cap`}>
      <figcaption id={`${id}-cap`} className={styles.fieldLabel}>
        {caption}
      </figcaption>
      <div className={styles.chart} aria-hidden="true">
        {points.map((p) => (
          <span
            key={p.label}
            className={styles.chartBar}
            style={{ height: `${Math.max(2, (p.value / max) * 100)}%` }}
            title={`${p.label}: ${p.display}`}
          />
        ))}
      </div>
      <details>
        <summary className={styles.small}>{at('charts.showTable')}</summary>
        <DataList caption={caption} rows={points.map((p) => [p.label, p.display])} />
      </details>
    </figure>
  );
}

/** Horizontal share bars (e.g. orders by status) with the value written next to each bar. */
export function ShareBars({
  items,
  caption,
}: {
  items: { key: string; label: ReactNode; value: number; display: string }[];
  caption: string;
}) {
  const total = items.reduce((n, i) => n + i.value, 0) || 1;
  return (
    <figure className={styles.figure}>
      <figcaption className={styles.fieldLabel}>{caption}</figcaption>
      <ul className={styles.shareList}>
        {items.map((i) => (
          <li key={i.key}>
            <span className={styles.shareHead}>
              <span>{i.label}</span>
              <span className={styles.num}>{i.display}</span>
            </span>
            <span className={styles.bar} aria-hidden="true">
              <span
                className={styles.barFill}
                style={{ display: 'block', width: `${(i.value / total) * 100}%` }}
              />
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

function DataList({ caption, rows }: { caption: string; rows: [string, string][] }) {
  return (
    <table className={styles.table}>
      <caption className="visually-hidden">{caption}</caption>
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <th scope="row">{k}</th>
            <td className={styles.num}>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
