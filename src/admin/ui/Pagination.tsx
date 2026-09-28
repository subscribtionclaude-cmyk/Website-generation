import { Button } from '@/components/ui/Button';
import { useI18n } from '@/i18n/context';
import { useAdminI18n } from '../i18n/context';
import styles from './adminUi.module.css';

/** Server-side pagination (limit / offset); never loads whole tables into the browser. */
export function Pagination({
  total,
  limit,
  offset,
  onChange,
}: {
  total: number;
  limit: number;
  offset: number;
  onChange: (offset: number) => void;
}) {
  const { at } = useAdminI18n();
  const { format } = useI18n();
  if (total <= limit && offset === 0) return null;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);
  return (
    <nav className={styles.pager} aria-label={at('ui.pagination')}>
      <span aria-live="polite">
        {at('ui.showing', {
          from: format.number(from),
          to: format.number(to),
          total: format.number(total),
        })}
      </span>
      <span className={styles.pagerButtons}>
        <Button
          size="sm"
          variant="secondary"
          disabled={offset === 0}
          onClick={() => onChange(Math.max(0, offset - limit))}
        >
          {at('ui.previous')}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={offset + limit >= total}
          onClick={() => onChange(offset + limit)}
        >
          {at('ui.next')}
        </Button>
      </span>
    </nav>
  );
}
