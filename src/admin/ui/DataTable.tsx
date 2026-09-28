import type { ReactNode } from 'react';
import { useAdminI18n } from '../i18n/context';
import styles from './adminUi.module.css';

export interface Column<T> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Render as the row header (<th scope="row">) — one column per table. */
  rowHeader?: boolean;
  className?: string;
}

/**
 * Dense admin table: internal scroll (the page never scrolls sideways), sticky header, optional
 * keyboard-accessible row selection with a labelled "select all visible" checkbox.
 */
export function DataTable<T>({
  caption,
  rows,
  rowKey,
  rowLabel,
  columns,
  selected,
  onSelectedChange,
  maxHeight,
}: {
  caption: string;
  rows: T[];
  rowKey: (row: T) => string;
  /** Accessible name of a row (used by its selection checkbox). */
  rowLabel?: (row: T) => string;
  columns: Column<T>[];
  selected?: ReadonlySet<string>;
  onSelectedChange?: (next: Set<string>) => void;
  maxHeight?: string;
}) {
  const { at } = useAdminI18n();
  const selectable = selected !== undefined && onSelectedChange !== undefined;
  const keys = rows.map(rowKey);
  const allSelected = selectable && keys.length > 0 && keys.every((k) => selected.has(k));
  const someSelected = selectable && keys.some((k) => selected.has(k));

  return (
    <div
      className={styles.tableWrap}
      role="region"
      aria-label={caption}
      // Scrollable regions must be focusable so keyboard users can scroll them.
      // eslint-disable-next-line jsx-a11y-x/no-noninteractive-tabindex
      tabIndex={0}
      style={maxHeight ? { maxHeight } : undefined}
    >
      <table className={styles.table}>
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {selectable && (
              <th scope="col" className={styles.selectCell}>
                <input
                  type="checkbox"
                  aria-label={at('ui.selectAll')}
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected && !allSelected;
                  }}
                  onChange={(e) => {
                    const next = new Set(selected);
                    for (const k of keys) {
                      if (e.target.checked) next.add(k);
                      else next.delete(k);
                    }
                    onSelectedChange(next);
                  }}
                />
              </th>
            )}
            {columns.map((c) => (
              <th key={c.id} scope="col" className={c.className}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = rowKey(row);
            const isSelected = selectable && selected.has(key);
            return (
              <tr key={key} aria-selected={selectable ? isSelected : undefined}>
                {selectable && (
                  <td className={styles.selectCell}>
                    <input
                      type="checkbox"
                      aria-label={at('ui.selectRow', { name: rowLabel?.(row) ?? key })}
                      checked={isSelected}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(key);
                        else next.delete(key);
                        onSelectedChange(next);
                      }}
                    />
                  </td>
                )}
                {columns.map((c) =>
                  c.rowHeader ? (
                    <th key={c.id} scope="row" className={c.className}>
                      {c.cell(row)}
                    </th>
                  ) : (
                    <td key={c.id} className={c.className}>
                      {c.cell(row)}
                    </td>
                  ),
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Sticky bar shown while rows are selected; actions stay permission-gated by the caller. */
export function BulkBar({
  count,
  onClear,
  children,
}: {
  count: number;
  onClear: () => void;
  children: ReactNode;
}) {
  const { at } = useAdminI18n();
  if (count === 0) return null;
  return (
    <div className={styles.bulkBar} role="region" aria-label={at('ui.selected', { count })}>
      <span className={styles.bulkCount} aria-live="polite">
        {at('ui.selected', { count })}
      </span>
      {children}
      <button type="button" className={styles.iconButton} onClick={onClear}>
        <span aria-hidden="true">×</span>
        <span className="visually-hidden">{at('ui.clearSelection')}</span>
      </button>
    </div>
  );
}
