import { ImagePlus } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import type { ProductStatus } from '@/domain/admin/schemas';
import { compressImage } from '@/lib/images/compressImage';
import { useAdminI18n, type AdminMessageKey } from '../../i18n/context';
import styles from '../../ui/adminUi.module.css';
import { useAdminRepo } from '../../ui/useAdminAction';
import { useErrorText } from '../../ui/useAdminText';

export function StatusBadge({ status }: { status: ProductStatus }) {
  const { at } = useAdminI18n();
  return (
    <Badge
      tone={status === 'published' ? 'success' : status === 'archived' ? 'neutral' : 'warning'}
    >
      {at(`catalog.status.${status}` as AdminMessageKey)}
    </Badge>
  );
}

export function StockStateBadge({ state }: { state: 'in_stock' | 'low' | 'out' | 'inactive' }) {
  const { at } = useAdminI18n();
  const tone =
    state === 'in_stock'
      ? 'success'
      : state === 'low'
        ? 'warning'
        : state === 'out'
          ? 'danger'
          : 'neutral';
  return <Badge tone={tone}>{at(`catalog.stockState.${state}` as AdminMessageKey)}</Badge>;
}

/** Upload a (compressed) image through the repository; returns the stored URL. */
export function ImageUpload({
  onUploaded,
  label,
  disabled,
}: {
  onUploaded: (url: string, size: { width: number; height: number } | null) => void;
  label?: string;
  disabled?: boolean;
}) {
  const { at } = useAdminI18n();
  const repo = useAdminRepo();
  const errorText = useErrorText();
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className={styles.field}>
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          setBusy(true);
          setError(null);
          try {
            const blob = await compressImage(file, 1600, 0.82);
            const bitmap = await createImageBitmap(blob).catch(() => null);
            const size = bitmap ? { width: bitmap.width, height: bitmap.height } : null;
            bitmap?.close();
            const { url } = await repo.uploadCatalogMedia(blob, blob.type || 'image/webp');
            onUploaded(url, size);
          } catch (err) {
            setError(
              err instanceof Error && err.message === 'not_an_image'
                ? at('ui.uploadFailed')
                : errorText(err, true),
            );
          } finally {
            setBusy(false);
          }
        }}
      />
      <button
        type="button"
        className={styles.iconButton}
        style={{
          width: 'auto',
          paddingInline: 'var(--space-3)',
          gap: 'var(--space-2)',
          display: 'inline-flex',
        }}
        disabled={busy || disabled}
        onClick={() => inputRef.current?.click()}
      >
        <ImagePlus aria-hidden="true" />
        {busy ? at('ui.uploading') : (label ?? at('ui.uploadImage'))}
      </button>
      {error && (
        <span className={styles.error} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
