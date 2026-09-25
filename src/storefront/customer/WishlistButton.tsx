import { Heart } from 'lucide-react';
import { useState } from 'react';
import { useCustomerLists, type WishlistToggleResult } from '@/features/customer/context';
import { useI18n } from '@/i18n/context';
import styles from './customer.module.css';

/**
 * Save / Saved toggle. State is conveyed by text (full variant) or the accessible name + pressed
 * state (icon variant) — never by the heart colour alone. Works signed out (browser list).
 */
export function WishlistButton({
  product,
  variantId = null,
  variant = 'icon',
}: {
  product: { id: string; slug: string; name: string };
  /** Only when the customer explicitly chose a variant (product page). */
  variantId?: string | null;
  variant?: 'icon' | 'full';
}) {
  const { t } = useI18n();
  const { wishlist } = useCustomerLists();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const saved = wishlist.isSaved(product.id, variant === 'full' ? variantId : undefined);

  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    const target =
      variant === 'icon' && saved
        ? (wishlist.entries.find((e) => e.productId === product.id) ?? { variantId: null })
        : { variantId };
    const result: WishlistToggleResult = await wishlist.toggle({
      productId: product.id,
      productSlug: product.slug,
      variantId: target.variantId,
    });
    setBusy(false);
    setMessage(
      result === 'saved'
        ? t('wishlist.addedStatus', { product: product.name })
        : result === 'removed'
          ? t('wishlist.removedStatus', { product: product.name })
          : result === 'full'
            ? t('wishlist.full')
            : t('wishlist.error'),
    );
  };

  const label = saved
    ? t('wishlist.removeLabel', { product: product.name })
    : t('wishlist.saveLabel', { product: product.name });
  return (
    <>
      <button
        type="button"
        className={[
          variant === 'icon' ? styles.iconToggle : styles.textToggle,
          saved && styles.toggleOn,
        ]
          .filter(Boolean)
          .join(' ')}
        aria-pressed={saved}
        aria-label={variant === 'icon' ? label : undefined}
        aria-busy={busy || undefined}
        onClick={() => void onClick()}
      >
        <Heart aria-hidden="true" fill={saved ? 'currentColor' : 'none'} />
        {variant === 'full' && <span>{saved ? t('wishlist.saved') : t('wishlist.save')}</span>}
        {variant === 'full' && <span className="visually-hidden">: {product.name}</span>}
      </button>
      <span className="visually-hidden" role="status">
        {message}
      </span>
    </>
  );
}
