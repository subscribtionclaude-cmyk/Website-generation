import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ImageUp, Trash2, X } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { resolveLocalized } from '@/domain/localized';
import { isSafeHref } from '@/domain/settings/schemas';
import { SITE_MEDIA_MAX_BYTES, SITE_MEDIA_TYPES } from '@/domain/siteEditor/schemas';
import { useI18n } from '@/i18n/context';
import { compressImage } from '@/lib/images/compressImage';
import { useRuntime } from '@/runtime/context';
import { useAdminI18n } from '../../i18n/context';
import { InputField, SelectField } from '../../ui/fields';
import type { CustomFieldProps } from '../../ui/SchemaForm';
import { useErrorText } from '../../ui/useAdminText';
import styles from '../../ui/adminUi.module.css';
import { SAFE_ROUTES } from './editorState';
import editor from './siteEditor.module.css';

/**
 * Link picker: a known storefront route, or a custom internal path / https URL (validated with the
 * same rule as the settings schemas — no javascript:, data: or protocol-relative links).
 */
export function RouteField({
  value,
  onChange,
  label,
  hint,
  error,
  readOnly,
  blankable,
}: CustomFieldProps) {
  const { at } = useAdminI18n();
  const current = typeof value === 'string' ? value : '';
  const known = (SAFE_ROUTES as readonly string[]).includes(current);
  const [custom, setCustom] = useState(!known && current !== '');
  const invalid = current !== '' && !isSafeHref(current);
  return (
    <div className={`${styles.full} ${editor.routeField}`}>
      <SelectField
        label={label}
        hint={hint}
        error={error}
        disabled={readOnly}
        value={custom ? '__custom' : current}
        onChange={(e) => {
          const next = e.target.value;
          if (next === '__custom') {
            setCustom(true);
            return;
          }
          setCustom(false);
          onChange(next === '' ? (blankable ? null : '') : next);
        }}
        options={[
          ...(blankable || current === '' ? [{ value: '', label: at('ui.none') }] : []),
          ...SAFE_ROUTES.map((r) => ({
            value: r,
            label: `${at(`siteEditor.route.${routeKey(r)}` as never)} (${r})`,
          })),
          { value: '__custom', label: at('siteEditor.route.custom') },
        ]}
      />
      {custom && (
        <InputField
          label={at('siteEditor.route.customLabel')}
          hint={at('siteEditor.route.customHint')}
          error={invalid ? at('problems.invalid_link') : null}
          disabled={readOnly}
          ltr
          value={current}
          onChange={(e) => onChange(e.target.value.trim())}
        />
      )}
    </div>
  );
}

function routeKey(route: string) {
  return route === '/' ? 'home' : route.slice(1).replace(/-/g, '_');
}

/**
 * Image control: preview, upload (raster only, compressed in the browser, stored through the
 * site-media storage), a URL field for existing media, and remove. SVG is refused (it can carry
 * script); the storage policy requires design.edit.
 */
export function MediaField({
  value,
  onChange,
  label,
  hint,
  error,
  readOnly,
  blankable,
}: CustomFieldProps) {
  const { at } = useAdminI18n();
  const { repositories } = useRuntime();
  const errorText = useErrorText();
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const url = typeof value === 'string' ? value : '';

  const upload = async (file: File) => {
    setProblem(null);
    if (!SITE_MEDIA_TYPES[file.type]) {
      setProblem(at('siteEditor.media.type'));
      return;
    }
    if (file.size > SITE_MEDIA_MAX_BYTES) {
      setProblem(at('siteEditor.media.size'));
      return;
    }
    setBusy(true);
    try {
      const small = await compressImage(file, 1600, 0.84).catch(() => file);
      const mime = small.type && SITE_MEDIA_TYPES[small.type] ? small.type : file.type;
      const result = await repositories.siteEditor.uploadMedia(small, mime);
      onChange(result.url);
    } catch (e) {
      setProblem(errorText(e, true));
    } finally {
      setBusy(false);
    }
  };

  return (
    <fieldset className={`${styles.group} ${styles.full}`} disabled={readOnly}>
      <legend>{label}</legend>
      <div className={editor.media}>
        <div className={editor.mediaPreview}>
          {url ? (
            <img src={url} alt="" />
          ) : (
            <span className={styles.muted}>{at('siteEditor.media.empty')}</span>
          )}
        </div>
        <div className={styles.stack}>
          <input
            ref={inputRef}
            id={id}
            type="file"
            accept={Object.keys(SITE_MEDIA_TYPES).join(',')}
            className="visually-hidden"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void upload(file);
            }}
          />
          <div className={styles.actions}>
            <Button
              size="sm"
              variant="secondary"
              icon={<ImageUp aria-hidden="true" />}
              loading={busy}
              onClick={() => inputRef.current?.click()}
            >
              {url ? at('siteEditor.media.replace') : at('siteEditor.media.upload')}
              <span className="visually-hidden">: {label}</span>
            </Button>
            {url && blankable && (
              <Button
                size="sm"
                variant="secondary"
                icon={<X aria-hidden="true" />}
                onClick={() => onChange(null)}
              >
                {at('siteEditor.media.remove')}
                <span className="visually-hidden">: {label}</span>
              </Button>
            )}
          </div>
          <InputField
            label={at('siteEditor.media.url')}
            hint={hint ?? at('siteEditor.media.hint')}
            error={error ?? problem}
            ltr
            value={url.startsWith('data:') ? '' : url}
            placeholder={url.startsWith('data:') ? at('siteEditor.media.inline') : undefined}
            onChange={(e) => {
              const next = e.target.value.trim();
              onChange(next === '' ? (blankable ? null : '') : next);
            }}
          />
        </div>
      </div>
    </fieldset>
  );
}

/**
 * Hand-picked products for a product rail: search the published catalog, add, reorder, remove.
 * Uses the public catalog (the same data the storefront shows), so no catalog permission is needed.
 */
export function ProductPicker({ value, onChange, label, readOnly }: CustomFieldProps) {
  const { at } = useAdminI18n();
  const { locale } = useI18n();
  const { repositories } = useRuntime();
  const [q, setQ] = useState('');
  const ids = Array.isArray(value) ? (value as string[]) : [];
  const picked = useQuery({
    queryKey: ['public', 'products-by-id', ids],
    queryFn: () => repositories.catalog.getProductsByIds(ids),
    enabled: ids.length > 0,
  });
  const search = useQuery({
    queryKey: ['public', 'catalog', { q, page: 1, pageSize: 8, sort: 'featured' as const }],
    queryFn: () =>
      repositories.catalog.search({ q, page: 1, pageSize: 8, sort: 'featured' as const }),
    enabled: q.trim().length >= 2,
  });
  const nameOf = (id: string) => {
    const p = picked.data?.find((x) => x.id === id);
    return p ? resolveLocalized(p.name, locale) : id;
  };
  const set = (next: string[]) => onChange(next);
  const move = (from: number, to: number) => {
    if (to < 0 || to >= ids.length) return;
    const next = [...ids];
    const [item] = next.splice(from, 1);
    if (item) next.splice(to, 0, item);
    set(next);
  };
  return (
    <fieldset className={`${styles.group} ${styles.full}`} disabled={readOnly}>
      <legend>
        {label} ({ids.length} / 12)
      </legend>
      {ids.length > 0 && (
        <ol className={editor.pickedList}>
          {ids.map((id, index) => (
            <li key={id}>
              <span>{nameOf(id)}</span>
              <span className={styles.rowActions}>
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label={`${at('ui.moveUp')}: ${nameOf(id)}`}
                  disabled={index === 0}
                  onClick={() => move(index, index - 1)}
                >
                  <ArrowUp aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label={`${at('ui.moveDown')}: ${nameOf(id)}`}
                  disabled={index === ids.length - 1}
                  onClick={() => move(index, index + 1)}
                >
                  <ArrowDown aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label={`${at('ui.remove')}: ${nameOf(id)}`}
                  onClick={() => set(ids.filter((x) => x !== id))}
                >
                  <Trash2 aria-hidden="true" />
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}
      <InputField
        label={at('siteEditor.products.search')}
        hint={at('siteEditor.products.searchHint')}
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {search.data && (
        <ul className={editor.pickedList} aria-label={at('siteEditor.products.results')}>
          {search.data.items.length === 0 && <li>{at('siteEditor.products.none')}</li>}
          {search.data.items.map((p) => (
            <li key={p.id}>
              <span>{resolveLocalized(p.name, locale)}</span>
              <Button
                size="sm"
                variant="secondary"
                disabled={ids.includes(p.id) || ids.length >= 12}
                onClick={() => set([...ids, p.id])}
              >
                {ids.includes(p.id)
                  ? at('siteEditor.products.added')
                  : at('siteEditor.products.add')}
                <span className="visually-hidden">: {resolveLocalized(p.name, locale)}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}
