import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import fixture from './__fixtures__/admin-samples.json';
import * as s from './schemas';
import { staffOrderSummarySchema } from '@/domain/commerce/schemas';

/**
 * The fixture is captured from the real SQL layer (supabase/tests/contracts/admin_samples.sql),
 * so these tests fail when a migration and the zod contracts drift apart.
 * `npm run test:db` re-runs this file against samples captured from a fresh database.
 */
const fromDb = (import.meta.env as Record<string, string | undefined>).ADMIN_SAMPLES_FILE;
const samples: typeof fixture = fromDb
  ? ((await import(/* @vite-ignore */ fromDb)) as { default: typeof fixture }).default
  : fixture;
const cases: [keyof typeof samples, z.ZodType][] = [
  ['admin_settings_overview', s.settingOverviewSchema.array()],
  ['admin_setting_versions', s.settingVersionSchema.array()],
  ['admin_list_audit_logs', s.pageSchema(s.auditRowSchema)],
  ['admin_get_audit_log', s.auditDetailSchema],
  ['admin_list_staff', s.staffMemberSchema.array()],
  ['admin_lookup_account', s.accountLookupSchema],
  ['admin_lookup_account_missing', s.accountLookupSchema],
  ['admin_list_roles', s.adminRoleSchema.array()],
  ['admin_catalog_lookups', s.catalogLookupsSchema],
  ['admin_list_products', s.pageSchema(s.productListItemSchema)],
  ['admin_get_product', s.adminProductSchema],
  ['admin_list_price_history', s.pageSchema(s.priceHistoryRowSchema)],
  ['admin_list_inventory', s.pageSchema(s.inventoryRowSchema)],
  ['admin_list_stock_movements', s.pageSchema(s.movementRowSchema)],
  ['admin_list_categories', s.adminCategorySchema.array()],
  ['admin_list_brands', s.adminBrandSchema.array()],
  ['staff_list_orders', s.pageSchema(staffOrderSummarySchema)],
  ['admin_order_assignees', s.assigneeSchema.array()],
  ['admin_list_customers', s.pageSchema(s.customerListItemSchema)],
  ['admin_get_customer', s.customerDetailSchema],
  ['admin_list_abandoned_carts', s.abandonedCartPageSchema],
  ['admin_list_service_requests', s.adminServicePageSchema],
  ['admin_list_service_requests_used', s.adminServicePageSchema],
  ['admin_service_context', s.serviceContextSchema],
  ['admin_list_reviews', s.pageSchema(s.adminReviewSchema)],
  ['admin_list_waitlist', s.pageSchema(s.waitlistRowSchema)],
  ['admin_list_notification_templates', s.notificationAdminSchema],
  ['admin_search_recipients', s.recipientSchema.array()],
  ['admin_list_offers', s.pageSchema(s.offerListItemSchema)],
  ['admin_get_offer', s.adminOfferSchema],
  ['admin_list_entries', s.pageSchema(s.entryListItemSchema)],
  ['admin_get_entry', s.adminEntrySchema],
  ['admin_list_page_sections', s.adminSectionSchema.array()],
  ['admin_dashboard', s.dashboardSchema],
  ['admin_analytics', s.analyticsSchema],
  ['admin_export_products', s.exportResultSchema],
  ['admin_list_import_jobs', s.importJobSchema.array()],
  ['admin_import_preview', s.importPreviewSchema],
];

describe('admin RPC contracts (captured SQL samples)', () => {
  it.each(cases)('%s parses', (name, schema) => {
    const result = schema.safeParse(samples[name]);
    if (!result.success) {
      throw new Error(`${name}: ${JSON.stringify(result.error.issues.slice(0, 6), null, 1)}`);
    }
    expect(result.success).toBe(true);
  });

  it('the fixture covers every contract case', () => {
    for (const [name] of cases) expect(samples[name], name).toBeDefined();
  });
});
