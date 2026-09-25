import { GitCompareArrows } from 'lucide-react';
import { useState } from 'react';
import type { ProductSummary } from '@/domain/catalog/types';
import { rootCategoryOf } from '@/domain/customer/compare';
import { useCustomerLists } from '@/features/customer/context';
import { useI18n } from '@/i18n/context';
import { useCategories } from '../data/hooks';
import styles from './customer.module.css';

/** Add to / remove from the comparison tray (same top-level category, at most N products). */
export function CompareButton({
  product,
  name,
  variant = 'icon',
}: {
  product: Pick<ProductSummary, 'id' | 'slug' | 'category'>;
  name: string;
  variant?: 'icon' | 'full';
}) {
  const { t } = useI18n();
  const { compare } = useCustomerLists();
  const categories = useCategories();
  const [message, setMessage] = useState<string | null>(null);
  const selected = compare.items.some((i) => i.productId === product.id);

  const onClick = () => {
    if (selected) {
      compare.remove(product.id);
      setMessage(t('compare.removedStatus', { product: name }));
      return;
    }
    const result = compare.add({
      productId: product.id,
      productSlug: product.slug,
      rootCategory: rootCategoryOf(product.category?.slug ?? null, categories.data ?? []),
    });
    setMessage(
      result === 'added'
        ? t('compare.addedStatus', { product: name, count: compare.items.length + 1 })
        : result === 'full'
          ? t('compare.full', { max: compare.max })
          : result === 'incompatible'
            ? t('compare.incompatible')
            : null,
    );
  };

  const label = selected
    ? t('compare.removeLabel', { product: name })
    : t('compare.addLabel', { product: name });
  return (
    <>
      <button
        type="button"
        className={[
          variant === 'icon' ? styles.iconToggle : styles.textToggle,
          selected && styles.toggleOn,
        ]
          .filter(Boolean)
          .join(' ')}
        aria-pressed={selected}
        aria-label={variant === 'icon' ? label : undefined}
        onClick={onClick}
      >
        <GitCompareArrows aria-hidden="true" />
        {variant === 'full' && <span>{selected ? t('compare.inCompare') : t('compare.add')}</span>}
      </button>
      {variant === 'full' &&
      message &&
      message !== t('compare.removedStatus', { product: name }) ? (
        <p className={styles.inlineStatus} role="status">
          {message}
        </p>
      ) : (
        <span className="visually-hidden" role="status">
          {message}
        </span>
      )}
    </>
  );
}
