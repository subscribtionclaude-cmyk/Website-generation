import type {
  AiProvider,
  CourierProvider,
  CourierQuote,
  ProviderResult,
  PublicContentInput,
  SearchProvider,
  ShipmentRequest,
  StorageProvider,
  StoredObject,
  SuggestionKind,
} from './adapters.ts';

/**
 * Business-facing services over the adapter interfaces. Each one keeps the free / manual path in
 * charge when a provider is missing, disabled or failing — no feature depends on a paid service.
 */

// ── AI content suggestions ──────────────────────────────────────────────────
/** Public catalog fields only: anything else on the product (cost, stock, notes, media) is ignored. */
export function buildAiInput(
  kind: SuggestionKind,
  locale: 'ar' | 'en',
  product: {
    name: string;
    brand?: string | null;
    category?: string | null;
    subtitle?: string | null;
    specs?: { label: string; value: string }[];
  },
): PublicContentInput {
  return {
    kind,
    locale,
    name: product.name.slice(0, 160),
    brand: product.brand?.slice(0, 80) ?? null,
    category: product.category?.slice(0, 80) ?? null,
    subtitle: product.subtitle?.slice(0, 160) ?? null,
    specs: (product.specs ?? [])
      .slice(0, 12)
      .map((s) => ({ label: s.label.slice(0, 60), value: s.value.slice(0, 120) })),
  };
}

/**
 * Generate → Review → Edit → Approve → Publish. A suggestion is only ever a draft placed in the
 * editor; it never publishes, and it never touches prices, stock, orders, payments, trade-in
 * valuations or repair pricing (the AI interface has no method that could).
 */
export async function suggestContent(
  provider: AiProvider | null,
  input: PublicContentInput,
): Promise<ProviderResult<{ draft: string; mock: boolean }>> {
  if (!provider)
    return { ok: false, code: 'config_incomplete', message: 'ai_disabled', retryable: false };
  const result = await provider.suggest(input);
  if (!result.ok) return result;
  return {
    ok: true,
    value: { draft: result.value.text.trim().slice(0, 1000), mock: provider.isMock },
  };
}

// ── Search ──────────────────────────────────────────────────────────────────
export async function searchWithFallback(
  provider: SearchProvider | null,
  query: string,
  builtIn: (query: string) => string[],
): Promise<{ slugs: string[]; source: 'provider' | 'built_in' }> {
  if (provider) {
    const result = await provider.query(query);
    if (result.ok) return { slugs: result.value.slugs, source: 'provider' };
  }
  return { slugs: builtIn(query), source: 'built_in' };
}

// ── Courier ─────────────────────────────────────────────────────────────────
/**
 * Checkout is never blocked by a courier: without a provider (or on any failure) the order keeps
 * the manual "Shipping fee to be confirmed" path.
 */
export async function courierQuoteOrManual(
  provider: CourierProvider | null,
  request: ShipmentRequest,
): Promise<{ mode: 'quoted'; quote: CourierQuote } | { mode: 'manual'; reason: string }> {
  if (!provider?.quote) return { mode: 'manual', reason: 'no_provider' };
  const result = await provider.quote(request);
  return result.ok
    ? { mode: 'quoted', quote: result.value }
    : { mode: 'manual', reason: result.code };
}

// ── Storage ─────────────────────────────────────────────────────────────────
/** Private media stays private whatever the provider: a private object must get an expiring URL. */
export async function safeObjectUrl(
  provider: StorageProvider,
  object: StoredObject,
  expiresIn = 300,
): Promise<ProviderResult<{ url: string; expiresAt: string | null }>> {
  const result = await provider.url(
    object,
    object.visibility === 'private' ? expiresIn : undefined,
  );
  if (!result.ok) return result;
  if (object.visibility === 'private' && !result.value.expiresAt)
    return {
      ok: false,
      code: 'permission_denied',
      message: 'private_object_without_expiry',
      retryable: false,
    };
  return result;
}

// ── Backup ──────────────────────────────────────────────────────────────────
/**
 * Manual CSV/JSON exports (Admin → Reports/Customers) are data extracts, NOT a database backup:
 * they omit auth users, storage objects, audit history and schema. Real backups come from
 * Supabase (daily backups / PITR on paid plans, or `supabase db dump`) or an optional backup
 * provider uploading a full dump.
 */
export const BACKUP_COVERAGE = {
  manual_export: { database: false, storage: false, auth: false, restorable: false },
  supabase_backup: { database: true, storage: false, auth: true, restorable: true },
  backup_provider: { database: true, storage: true, auth: true, restorable: true },
} as const;
