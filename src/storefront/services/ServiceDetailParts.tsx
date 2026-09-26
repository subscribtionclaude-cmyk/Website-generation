import { useQuery } from '@tanstack/react-query';
import { Film } from 'lucide-react';
import type { LocalizedText } from '@/domain/localized';
import { resolveLocalized } from '@/domain/localized';
import {
  afterSalesDetailsSchema,
  repairDetailsSchema,
  tradeInDetailsSchema,
  usedDetailsSchema,
} from '@/domain/services/schemas';
import type { ServiceMediaItem, ServiceRequestDetail } from '@/domain/services/types';
import { useI18n, type CoreMessageKey } from '@/i18n/context';
import { isolate } from '@/i18n/translator';
import { useRuntime } from '@/runtime/context';
import { AFTER_SALES_TYPE_LABEL } from './serviceLabels';
import styles from './services.module.css';

/** Shared by the customer request page and the staff request screens. */
export function RequestSummary({ request }: { request: ServiceRequestDetail }) {
  const { t, locale, format } = useI18n();
  const rows: [string, string][] = [];
  const label = (value: LocalizedText | null | undefined) =>
    value ? resolveLocalized(value, locale) : null;
  if (request.kind === 'repair') {
    const d = repairDetailsSchema.safeParse(request.details).data;
    rows.push([t('services.device'), `${request.brand ?? ''} ${request.model ?? ''}`.trim()]);
    const issue = [label(d?.diagnosis?.componentLabel), label(d?.diagnosis?.symptomLabel)]
      .filter(Boolean)
      .join(' — ');
    rows.push([t('repairs.issue'), issue || t('repairs.consultation')]);
    if (d?.description) rows.push([t('requestDetail.description'), d.description]);
    if (request.handoff)
      rows.push([
        t('repairs.handoff'),
        request.handoff === 'store_visit' ? t('repairs.handoffStore') : t('repairs.handoffPickup'),
      ]);
  } else if (request.kind === 'trade_in') {
    const c = tradeInDetailsSchema.safeParse(request.details).data?.current;
    if (c) {
      rows.push([
        t('tradeIn.currentDevice'),
        [c.brand, c.model, c.storage, c.color]
          .filter(Boolean)
          .map((x) => isolate(String(x)))
          .join(' · '),
      ]);
      rows.push([
        t('tradeIn.batteryHealth'),
        c.batteryHealth ? `${format.number(c.batteryHealth)}%` : t('services.notSpecified'),
      ]);
      rows.push([
        t('tradeIn.conditionTitle'),
        (c.conditions ?? []).map((x) => t(`tradeIn.cond_${x}` as CoreMessageKey)).join('، '),
      ]);
      if ((c.accessories ?? []).length > 0)
        rows.push([
          t('tradeIn.accessoriesTitle'),
          (c.accessories ?? []).map((x) => t(`tradeIn.acc_${x}` as CoreMessageKey)).join('، '),
        ]);
    }
    const target = request.target;
    if (target) {
      const name = target.name
        ? resolveLocalized(target.name, locale)
        : [target.brand, target.model].filter((x) => typeof x === 'string').join(' ');
      rows.push([
        t('tradeIn.targetDevice'),
        [name, target.variantLabel ? resolveLocalized(target.variantLabel, locale) : target.storage]
          .filter(Boolean)
          .map((x) => isolate(String(x)))
          .join(' · '),
      ]);
      if (request.targetIsCatalog && typeof target.price === 'number')
        rows.push([t('requestDetail.targetCurrentPrice'), format.money(target.price)]);
    }
  } else if (request.kind === 'used') {
    const d = usedDetailsSchema.safeParse(request.details).data?.device;
    if (d) {
      rows.push([
        t('services.device'),
        [d.brand, d.model, d.storage, d.color]
          .filter(Boolean)
          .map((x) => isolate(String(x)))
          .join(' · '),
      ]);
      rows.push([
        t('used.batteryPreference'),
        t(`used.battery_${d.batteryPreference ?? 'none'}` as CoreMessageKey),
      ]);
      rows.push([
        t('used.taxPreference'),
        t(`used.tax_${d.taxPreference ?? 'no_preference'}` as CoreMessageKey),
      ]);
      if (d.budget) rows.push([t('used.budget'), format.money(d.budget)]);
      if (d.notes) rows.push([t('used.notes'), d.notes]);
    }
  } else {
    const d = afterSalesDetailsSchema.safeParse(request.details).data;
    if (request.afterSalesType)
      rows.push([
        t('afterSales.typeTitle'),
        t(AFTER_SALES_TYPE_LABEL[request.afterSalesType] ?? 'afterSales.typeWarranty'),
      ]);
    if (request.order) rows.push([t('requestDetail.order'), request.order.number]);
    if (d?.reason)
      rows.push([t('afterSales.reason'), t(`afterSales.reason_${d.reason}` as CoreMessageKey)]);
    if (d?.description) rows.push([t('afterSales.description'), d.description]);
    if (request.policyVersion)
      rows.push([t('requestDetail.policyAcknowledged'), request.policyVersion]);
  }
  return (
    <dl className={styles.summary}>
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{isolate(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function MediaGallery({ items }: { items: ServiceMediaItem[] }) {
  const { t } = useI18n();
  const { repositories } = useRuntime();
  const urls = useQuery({
    queryKey: ['service-media-urls', items.map((m) => `${m.bucket}/${m.path}`)],
    queryFn: () =>
      repositories.services.mediaUrls(items.map((m) => ({ bucket: m.bucket, path: m.path }))),
    enabled: items.length > 0,
    staleTime: 10 * 60_000,
  });
  if (items.length === 0) return null;
  return (
    <ul className={styles.mediaGrid} aria-label={t('requestDetail.media')}>
      {items.map((m, index) => {
        const url = urls.data?.[`${m.bucket}/${m.path}`];
        const name = m.label
          ? t(`media.label_${m.label}` as CoreMessageKey)
          : t('media.fileName', { index: index + 1 });
        return (
          <li key={m.id}>
            {url ? (
              <a href={url} target="_blank" rel="noopener noreferrer">
                {m.mediaType === 'video' ? (
                  <Film aria-hidden="true" />
                ) : (
                  <img src={url} alt={name} loading="lazy" />
                )}
                {m.mediaType === 'video' && <span className="visually-hidden">{name}</span>}
              </a>
            ) : (
              <span>
                {m.mediaType === 'video' ? <Film aria-hidden="true" /> : null}
                {name}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
