import { formatDiffValue, type DiffEntry } from '@/domain/admin/diff';
import { useAdminI18n, type AdminMessageKey } from '../i18n/context';
import styles from './adminUi.module.css';

/** Before / after table for audit entries and setting versions (values shown as plain text). */
export function DiffTable({ entries, caption }: { entries: DiffEntry[]; caption: string }) {
  const { at } = useAdminI18n();
  if (entries.length === 0) return <p className={styles.muted}>{at('diff.none')}</p>;
  return (
    <div
      className={styles.tableWrap}
      role="region"
      aria-label={caption}
      // Scrollable regions must be focusable so keyboard users can scroll them.
      // eslint-disable-next-line jsx-a11y-x/no-noninteractive-tabindex
      tabIndex={0}
      style={{ maxHeight: '60vh' }}
    >
      <table className={`${styles.table} ${styles.diffTable}`}>
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{at('diff.field')}</th>
            <th scope="col">{at('diff.change')}</th>
            <th scope="col">{at('diff.before')}</th>
            <th scope="col">{at('diff.after')}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.path}>
              <th scope="row" className={styles.mono}>
                {e.path}
              </th>
              <td>{at(`diff.kind.${e.kind}` as AdminMessageKey)}</td>
              <td className={e.kind !== 'added' ? styles.diffRemoved : undefined}>
                <span className={styles.mono}>{formatDiffValue(e.before)}</span>
              </td>
              <td className={e.kind !== 'removed' ? styles.diffAdded : undefined}>
                <span className={styles.mono}>{formatDiffValue(e.after)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
