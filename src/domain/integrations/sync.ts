import type { ExternalRecord } from './adapters.ts';
import type { Ownership, SyncDomain } from './types.ts';

/**
 * ERP / POS sync planner (mirrors app.integration_plan_record so demo mode and the database agree).
 *
 * Matching: an explicit external-ID mapping first, else the exact SKU (variants) or the exact sign-in
 * email (customers) — never fuzzy names. Ownership per domain:
 *   malek          external values ignored (Malek Store is the source of truth)
 *   external       external values applied; a local edit since the last sync → conflict (review)
 *   external_wins  external values always applied
 * Stock is never set below active reservations, whatever the policy. New products / customers are
 * listed for review, never created automatically. Malek's own IDs are never replaced.
 */
export type PlanAction =
  'create' | 'update' | 'link' | 'unchanged' | 'skip' | 'conflict' | 'invalid';

export interface PlanItem {
  action: PlanAction;
  reason: string | null;
  entity: 'variant' | 'customer';
  externalId: string | null;
  localId: string | null;
  label: string | null;
  /** Mapping should be recorded (first match by SKU / email). */
  link?: boolean;
  detail?: Record<string, unknown>;
}

export interface LocalVariant {
  id: string;
  sku: string;
  price: number | null;
  compareAtPrice: number | null;
  stock: number;
  reserved: number;
  updatedAt: string;
}

export interface Mapping {
  entity: 'variant' | 'customer' | 'product' | 'order' | 'category';
  externalId: string;
  localId: string;
  externalUpdatedAt: string | null;
  syncedAt: string;
}

export interface PlanContext {
  domain: SyncDomain;
  owner: Ownership;
  variants: LocalVariant[];
  customers: { id: string; email: string }[];
  mappings: Mapping[];
}

const EXTERNAL_ID = /^[A-Za-z0-9_.:/-]{1,120}$/;

const ms = (iso: string) => new Date(iso).getTime();

export function planRecord(record: ExternalRecord, ctx: PlanContext): PlanItem {
  const ext = record.externalId?.trim() || null;
  const entity = ctx.domain === 'customers' ? 'customer' : 'variant';
  const base = {
    entity,
    externalId: ext,
    localId: null,
    label: record.name ?? record.sku ?? record.email ?? ext,
  } as const;
  if (!ext || !EXTERNAL_ID.test(ext))
    return { ...base, action: 'invalid', reason: 'invalid_external_id' };
  const updated = record.updatedAt ?? null;
  if (updated !== null && Number.isNaN(new Date(updated).getTime()))
    return { ...base, action: 'invalid', reason: 'invalid_timestamp' };

  if (ctx.domain === 'customers') {
    const mapped = ctx.mappings.find((m) => m.entity === 'customer' && m.externalId === ext);
    if (mapped) return { ...base, action: 'unchanged', reason: null, localId: mapped.localId };
    const email = record.email?.trim().toLowerCase();
    const customer = email ? ctx.customers.find((c) => c.email.toLowerCase() === email) : undefined;
    if (!customer) return { ...base, action: 'create', reason: 'review_required' };
    if (ctx.mappings.some((m) => m.entity === 'customer' && m.localId === customer.id))
      return { ...base, action: 'conflict', reason: 'already_linked', localId: customer.id };
    return { ...base, action: 'link', reason: null, localId: customer.id };
  }

  const mapping = ctx.mappings.find((m) => m.entity === 'variant' && m.externalId === ext);
  const variant = mapping
    ? ctx.variants.find((v) => v.id === mapping.localId)
    : record.sku
      ? ctx.variants.find((v) => v.sku === record.sku?.trim())
      : undefined;
  if (!variant) {
    return ctx.domain === 'products'
      ? { ...base, action: 'create', reason: 'review_required' }
      : { ...base, action: 'skip', reason: 'unmatched' };
  }
  const found = { ...base, localId: variant.id, label: variant.sku };
  if (!mapping && ctx.mappings.some((m) => m.entity === 'variant' && m.localId === variant.id))
    return { ...found, action: 'conflict', reason: 'already_linked' };
  if (ctx.domain === 'products')
    return { ...found, action: mapping ? 'unchanged' : 'link', reason: null };

  let next: number;
  let compareAt: number | null = null;
  if (ctx.domain === 'prices') {
    const price = record.price;
    compareAt = record.compareAt ?? null;
    if (
      typeof price !== 'number' ||
      !Number.isFinite(price) ||
      price < 0 ||
      price > 10_000_000 ||
      (compareAt !== null && compareAt <= price)
    )
      return { ...found, action: 'invalid', reason: 'invalid_price' };
    next = Math.round(price * 100) / 100;
  } else {
    const stock = record.stock;
    if (typeof stock !== 'number' || !Number.isInteger(stock) || stock < 0 || stock > 1_000_000)
      return { ...found, action: 'invalid', reason: 'invalid_stock' };
    next = stock;
  }

  if (ctx.owner === 'malek') return { ...found, action: 'skip', reason: 'owned_by_malek' };
  const current = ctx.domain === 'prices' ? variant.price : variant.stock;
  const sameCompare = compareAt === null || compareAt === variant.compareAtPrice;
  if (current === next && (ctx.domain !== 'prices' || sameCompare))
    return { ...found, action: 'unchanged', reason: null, link: !mapping };
  if (
    mapping &&
    updated &&
    mapping.externalUpdatedAt &&
    ms(updated) <= ms(mapping.externalUpdatedAt)
  )
    return { ...found, action: 'skip', reason: 'not_newer' };
  if (ctx.domain === 'stock' && next < variant.reserved)
    return {
      ...found,
      action: 'conflict',
      reason: 'below_reserved',
      detail: { stock: next, reserved: variant.reserved },
    };
  const detail: Record<string, unknown> =
    ctx.domain === 'prices'
      ? { before: variant.price, after: next, compareAt }
      : { before: variant.stock, after: next };
  if (ctx.owner === 'external') {
    const localNewer = mapping
      ? ms(variant.updatedAt) > ms(mapping.syncedAt)
      : updated
        ? ms(variant.updatedAt) > ms(updated)
        : true;
    if (localNewer)
      return {
        ...found,
        action: 'conflict',
        reason: !mapping && !updated ? 'no_timestamp' : 'local_changed',
        detail,
      };
  }
  return { ...found, action: 'update', reason: null, link: !mapping, detail };
}

export interface PlanSummary {
  inspected: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  conflicts: number;
}

export function summarize(items: readonly { action: PlanAction }[]): PlanSummary {
  const n = (...actions: PlanAction[]) => items.filter((i) => actions.includes(i.action)).length;
  return {
    inspected: items.length,
    created: n('link', 'create'),
    updated: n('update'),
    skipped: n('skip', 'unchanged'),
    failed: n('invalid'),
    conflicts: n('conflict'),
  };
}

export function jobStatus(summary: PlanSummary): 'completed' | 'partial' {
  return summary.conflicts + summary.failed > 0 ? 'partial' : 'completed';
}
