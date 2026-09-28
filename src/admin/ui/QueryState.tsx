import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Alert } from '@/components/feedback/Alert';
import { Skeleton } from '@/components/feedback/Skeleton';
import { Button } from '@/components/ui/Button';
import { useAdminI18n } from '../i18n/context';
import styles from './adminUi.module.css';
import { useErrorText } from './useAdminText';

/**
 * Loading / error / empty states for one query. Errors never show raw backend messages:
 * permission, connectivity and unexpected-payload problems each get a readable sentence.
 */
export function QueryState<T>({
  query,
  children,
  isEmpty,
  empty,
  skeletonHeight = '16rem',
}: {
  query: UseQueryResult<T>;
  children: (data: T) => ReactNode;
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  skeletonHeight?: string;
}) {
  const { at } = useAdminI18n();
  const errorText = useErrorText();
  if (query.isPending) return <Skeleton height={skeletonHeight} radius="var(--radius-lg)" />;
  if (query.isError)
    return (
      <Alert
        tone="danger"
        live
        action={
          <Button size="sm" variant="secondary" onClick={() => void query.refetch()}>
            {at('ui.retry')}
          </Button>
        }
      >
        {errorText(query.error)}
      </Alert>
    );
  if (isEmpty?.(query.data))
    return <div className={styles.emptyBox}>{empty ?? at('ui.empty')}</div>;
  return <>{children(query.data)}</>;
}
