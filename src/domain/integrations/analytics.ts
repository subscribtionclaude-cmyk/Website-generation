import { isPrivatePath } from '@/domain/seo/site';

/**
 * Google Analytics 4 rules (browser only). OFF by default; loaded only after the visitor accepts
 * analytics cookies; never on private pages; only whitelisted, non-personal event parameters.
 */
// ── Analytics (Google Analytics 4) ──────────────────────────────────────────
/** Safe commerce events only; parameters are whitelisted, and nothing personal is ever sent. */
export const ANALYTICS_EVENTS = [
  'page_view',
  'view_item',
  'add_to_cart',
  'begin_checkout',
  'search',
  'generate_lead',
] as const;
export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

const SAFE_PARAMS = new Set([
  'page_path',
  'page_location',
  'page_title',
  'item_id',
  'item_name',
  'item_brand',
  'item_category',
  'currency',
  'value',
  'quantity',
  'lead_type',
  'search_term',
]);
const PII = [
  /[^\s@]+@[^\s@]+\.[^\s@]+/, // email
  /(?:\+?20|0)1[0125]\d{8}/, // Egyptian mobile
  /\d{9,}/, // long digit runs (phone / IDs / card-like numbers)
];

export function sanitizeAnalyticsParams(
  params: Record<string, unknown>,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(params)) {
    if (!SAFE_PARAMS.has(key)) continue;
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else if (typeof value === 'string') {
      const text = value.slice(0, 100);
      if (PII.some((re) => re.test(text))) continue;
      out[key] = text;
    }
  }
  return out;
}

/**
 * Analytics never loads or reports on private areas: admin, account (incl. sign-in), cart,
 * checkout, orders / invoices, wishlist, compare (the robots / service-worker private list) and
 * the service request forms (repair, trade-in, used, after-sales), whose contents are personal.
 */
export function isAnalyticsAllowedPath(pathname: string): boolean {
  if (isPrivatePath(pathname)) return false;
  return !/^\/(?:en\/)?(?:repairs|trade-in|used|after-sales)\/request(?:\/|$)/.test(pathname);
}
