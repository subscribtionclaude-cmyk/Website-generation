import { useQuery } from '@tanstack/react-query';
import { Plus, Search, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import type { LocalizedText } from '@/domain/localized';
import { useAdminI18n, type AdminMessageKey } from '../../i18n/context';
import { InputField } from '../../ui/fields';
import styles from '../../ui/adminUi.module.css';
import { useAdminRepo } from '../../ui/useAdminAction';
import { useLocalized } from '../catalog/catalogHooks';

export function PublicationStateBadge({ state }: { state: string }) {
  const { at } = useAdminI18n();
  const tone =
    state === 'active' || state === 'published'
      ? 'success'
      : state === 'scheduled'
        ? 'info'
        : state === 'draft'
          ? 'warning'
          : 'neutral';
  return <Badge tone={tone}>{at(`contentAdmin.state.${state}` as AdminMessageKey)}</Badge>;
}

export interface PickedProduct {
  productId: string;
  name: LocalizedText;
  slug: string;
}

/** Search the catalog and add products (admin list → includes drafts; the storefront hides them). */
export function ProductPicker({
  picked,
  onAdd,
  disabled,
}: {
  picked: string[];
  onAdd: (product: PickedProduct) => void;
  disabled?: boolean;
}) {
  const { at } = useAdminI18n();
  const repo = useAdminRepo();
  const loc = useLocalized();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState<string | null>(null);
  const results = useQuery({
    queryKey: ['admin', 'product-picker', term],
    queryFn: () => repo.listProducts({ q: term, limit: 8, offset: 0, sort: 'name' }),
    enabled: term !== null,
  });
  return (
    <div className={styles.stack}>
      <div className={styles.filters} role="search" aria-label={at('contentAdmin.productSearch')}>
        <InputField
          label={at('contentAdmin.productSearch')}
          type="search"
          value={q}
          disabled={disabled}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              setTerm(q.trim());
            }
          }}
        />
        <div className={styles.filterActions}>
          <Button
            variant="secondary"
            icon={<Search aria-hidden="true" />}
            disabled={disabled}
            onClick={() => setTerm(q.trim())}
          >
            {at('ui.search')}
          </Button>
        </div>
      </div>
      {term !== null && results.data && (
        <ul className={styles.pickList} aria-live="polite">
          {results.data.items.length === 0 && <li className={styles.muted}>{at('ui.empty')}</li>}
          {results.data.items.map((p) => (
            <li key={p.id}>
              <span className={styles.cellTitle}>
                <span>{loc(p.name)}</span>
                <span className={`${styles.mono} ${styles.muted}`}>{p.slug}</span>
              </span>
              {p.status !== 'published' && (
                <Badge>{at(`catalog.status.${p.status}` as AdminMessageKey)}</Badge>
              )}
              <Button
                size="sm"
                variant="secondary"
                icon={<Plus aria-hidden="true" />}
                disabled={disabled || picked.includes(p.id)}
                onClick={() => onAdd({ productId: p.id, name: p.name, slug: p.slug })}
              >
                <span>
                  {at('ui.add')}
                  <span className="visually-hidden">: {loc(p.name)}</span>
                </span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className={styles.iconButton} aria-label={label} onClick={onClick}>
      <Trash2 aria-hidden="true" />
    </button>
  );
}
