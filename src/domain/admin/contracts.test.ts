import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import fixture from './__fixtures__/admin-samples.json';
import * as s from './schemas';
import { staffOrderSummarySchema } from '@/domain/commerce/schemas';
import { pageSectionSchema } from '@/domain/content/schemas';
import { resolveSections } from '@/domain/content/sections';
import { seoOverviewSchema } from '@/domain/seo/overview';
import { seoPublicIndexSchema } from '@/domain/seo/publicIndex';
import {
  deliverySchema,
  healthCheckSchema,
  integrationFeaturesSchema,
  integrationsOverviewSchema,
  storefrontIntegrationsSchema,
  syncJobDetailSchema,
  syncJobSchema,
  webhookEventSchema,
} from '@/domain/integrations/schemas';
import { DEMO_CHOICES } from '@/domain/setup/wizard';
import {
  editorPageSchema,
  editorPageSummarySchema,
  layoutVersionSchema,
} from '@/domain/siteEditor/schemas';

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
  ['admin_seo_overview', seoOverviewSchema],
  ['seo_public_index', seoPublicIndexSchema],
  ['admin_complete_setup_invalid', s.adminProblemSchema],
  [
    'admin_complete_setup',
    s.okSchema.extend({ demoChoice: z.enum(DEMO_CHOICES), deleted: z.null() }),
  ],
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
  ['site_editor_overview', editorPageSummarySchema.array()],
  ['site_editor_get_page', editorPageSchema],
  ['site_editor_versions', layoutVersionSchema.array()],
  ['site_editor_conflict', s.adminProblemSchema],
  ['storefront_page_sections', pageSectionSchema.array()],
  ['admin_integrations_overview', integrationsOverviewSchema],
  ['admin_list_integration_checks', healthCheckSchema.array()],
  ['admin_list_sync_jobs', syncJobSchema.array()],
  ['admin_get_sync_job', syncJobDetailSchema],
  ['admin_list_deliveries', deliverySchema.array()],
  ['admin_list_webhook_events', webhookEventSchema.array()],
  ['admin_integration_features', integrationFeaturesSchema],
  ['admin_save_integration_refused', s.adminProblemSchema],
  ['storefront_integrations', storefrontIntegrationsSchema],
];

describe('admin RPC contracts (captured SQL samples)', () => {
  it.each(cases)('%s parses', (name, schema) => {
    const result = schema.safeParse(samples[name]);
    if (!result.success) {
      throw new Error(`${name}: ${JSON.stringify(result.error.issues.slice(0, 6), null, 1)}`);
    }
    expect(result.success).toBe(true);
  });

  it('site editor samples keep drafts, versions and section design intact', () => {
    const page = editorPageSchema.parse(samples.site_editor_get_page);
    expect(page.version).toBe(2);
    expect(page.draft?.[0]?.design).toEqual({ background: 'muted' });
    const versions = layoutVersionSchema.array().parse(samples.site_editor_versions);
    expect(versions.map((v) => v.note)).toEqual(['Sample publish', 'Initial layout']);
    expect(s.adminProblemSchema.parse(samples.site_editor_conflict).code).toBe('draft_conflict');
    // The published layout renders: every section resolves through the storefront registry.
    const rows = pageSectionSchema.array().parse(samples.storefront_page_sections);
    expect(resolveSections(rows)).toHaveLength(rows.length);
  });

  it('integration samples: every catalog key, a dry-run plan and public flags only', () => {
    const overview = integrationsOverviewSchema.parse(samples.admin_integrations_overview);
    expect(overview.integrations).toHaveLength(12);
    expect(overview.integrations.find((i) => i.key === 'odoo')).toMatchObject({
      provider: 'odoo_jsonrpc',
      enabled: false,
      complete: true,
    });
    const job = syncJobDetailSchema.parse(samples.admin_get_sync_job);
    expect(job).toMatchObject({ dryRun: true, status: 'partial', inspected: 3, updated: 1 });
    expect(job.items.map((i) => i.action)).toEqual(['update', 'invalid', 'skip']);
    expect(job.items.every((i) => !i.applied)).toBe(true);
    expect(samples.admin_save_integration_refused).toMatchObject({
      code: 'secret_not_allowed',
      field: 'username',
    });
    expect(deliverySchema.array().parse(samples.admin_list_deliveries)[0]).toMatchObject({
      channel: 'whatsapp',
      status: 'failed',
      reference: 'MS-1',
    });
    expect(samples.storefront_integrations).toEqual({
      analytics: { provider: 'ga4', measurementId: 'G-SAMPLE123' },
      socialAuth: { google: false, apple: false },
    });
  });

  it('the fixture covers every contract case', () => {
    for (const [name] of cases) expect(samples[name], name).toBeDefined();
  });
});
