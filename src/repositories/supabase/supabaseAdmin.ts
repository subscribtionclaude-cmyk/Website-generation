import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import * as s from '@/domain/admin/schemas';
import type { AdminResult } from '@/domain/admin/schemas';
import { RepositoryError } from './errors';
import { rpc } from './rpc';
import type { AdminRepository } from '../adminTypes';

/**
 * Phase 06 admin port over the SECURITY DEFINER RPCs in supabase/migrations/20260929*_admin_*.sql.
 * Permission checks, validation, stale-edit detection and audit logging all happen in the
 * database; this adapter only shapes arguments and validates responses.
 */
const MEDIA_EXT: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/avif': 'avif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

/** Exceptions some older RPCs raise for business refusals → `{ ok: false, code }`. */
const BUSINESS_EXCEPTIONS = [
  'draft_conflict',
  'no_draft',
  'version_not_found',
  'setting_not_published',
  'invalid_setting_value',
  'role_not_found',
  'owner_role_is_implicit',
  'cannot_edit_role_at_or_above_own_rank',
  'cannot_grant_permission_you_do_not_hold',
  'unknown_permission',
  'mfa_required',
  'user_not_found',
  'only_owner_can_grant_owner',
  'only_owner_can_revoke_owner',
  'cannot_grant_role_at_or_above_own_rank',
  'cannot_revoke_role_at_or_above_own_rank',
  'cannot_remove_last_owner',
];

const intSchema = z.coerce.number().int();
const pageOf = s.pageSchema;

export class SupabaseAdminRepository implements AdminRepository {
  private readonly client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.client = client;
  }

  private call<T>(fn: string, args: Record<string, unknown>, schema: z.ZodType<T>) {
    return rpc(this.client, fn, args, schema);
  }

  /** Like `call`, but known business exceptions become `{ ok: false, code }`. */
  private async business<T extends object>(
    fn: string,
    args: Record<string, unknown>,
    schema: z.ZodType<T>,
  ): Promise<AdminResult<T>> {
    try {
      return { ok: true, ...(await this.call(fn, args, schema)) } as AdminResult<T>;
    } catch (error) {
      const message =
        error instanceof RepositoryError && error.cause && typeof error.cause === 'object'
          ? String((error.cause as { message?: unknown }).message ?? '')
          : '';
      const code = BUSINESS_EXCEPTIONS.find((c) => message.startsWith(c));
      if (code) return { ok: false, code };
      throw error;
    }
  }

  // ── System ───────────────────────────────────────────────────────────────
  async touchActivity() {
    await this.client.rpc('admin_touch_activity');
  }
  settingsOverview() {
    return this.call('admin_settings_overview', {}, s.settingOverviewSchema.array());
  }
  settingVersions(key: string, limit = 30) {
    return this.call(
      'admin_setting_versions',
      { p_key: key, p_limit: limit },
      s.settingVersionSchema.array(),
    );
  }
  saveSettingDraft(key: string, value: Record<string, unknown>, expectedDraftAt: string | null) {
    return this.call(
      'admin_save_setting_draft',
      { p_key: key, p_value: value, p_expected_draft_at: expectedDraftAt },
      z.union([
        z.object({
          ok: z.literal(true),
          draftUpdatedAt: z.string(),
          baseVersion: z.number().int().nullable(),
        }),
        s.adminProblemSchema,
      ]),
    );
  }
  async discardSettingDraft(key: string) {
    await this.call('discard_setting_draft', { p_key: key }, z.unknown());
  }
  publishSetting(key: string, note: string | null, force = false) {
    return this.business(
      'publish_setting',
      { p_key: key, p_note: note, p_force: force },
      intSchema.transform((version) => ({ version })),
    );
  }
  rollbackSetting(key: string, version: number, note: string | null) {
    return this.business(
      'rollback_setting',
      { p_key: key, p_version: version, p_note: note },
      intSchema.transform((v) => ({ version: v })),
    );
  }
  listAuditLogs(filter: s.AuditFilter) {
    return this.call('admin_list_audit_logs', { p_filter: filter }, pageOf(s.auditRowSchema));
  }
  getAuditLog(id: number) {
    return this.call('admin_get_audit_log', { p_id: id }, s.auditDetailSchema.nullable());
  }
  listStaff(filter: { q?: string | null; status?: 'active' | 'suspended' | null } = {}) {
    return this.call('admin_list_staff', { p_filter: filter }, s.staffMemberSchema.array());
  }
  lookupAccount(email: string) {
    return this.call('admin_lookup_account', { p_email: email }, s.accountLookupSchema);
  }
  changeStaffRole(userId: string, fromRole: string | null, toRole: string | null) {
    return this.business(
      'admin_change_staff_role',
      { p_user_id: userId, p_from_role: fromRole, p_to_role: toRole },
      s.adminResultSchema,
    );
  }
  setStaffSuspended(userId: string, suspended: boolean, reason: string | null) {
    return this.call(
      'admin_set_staff_suspended',
      { p_user_id: userId, p_suspended: suspended, p_reason: reason },
      s.adminResultSchema,
    );
  }
  listRoles() {
    return this.call('admin_list_roles', {}, s.adminRoleSchema.array());
  }
  setRolePermissions(roleKey: string, permissions: string[]) {
    return this.business(
      'set_role_permissions',
      { p_role_key: roleKey, p_permissions: permissions },
      z.unknown().transform(() => ({})),
    );
  }
  demoSummary() {
    return this.call('demo_data_summary', {}, z.record(z.string(), intSchema));
  }
  deleteDemoData() {
    return this.call('delete_all_demo_data', {}, z.record(z.string(), intSchema));
  }

  // ── Catalog ──────────────────────────────────────────────────────────────
  catalogLookups() {
    return this.call('admin_catalog_lookups', {}, s.catalogLookupsSchema);
  }
  listProducts(filter: s.ProductFilter) {
    return this.call('admin_list_products', { p_filter: filter }, pageOf(s.productListItemSchema));
  }
  getProduct(id: string) {
    return this.call('admin_get_product', { p_id: id }, s.adminProductSchema.nullable());
  }
  saveProduct(input: s.ProductInput) {
    return this.call('admin_save_product', { p_payload: input }, s.saveResultSchema);
  }
  setProductsState(ids: string[], action: s.ProductStateAction) {
    return this.call(
      'admin_set_products_state',
      { p_ids: ids, p_action: action },
      s.countResultSchema,
    );
  }
  duplicateProduct(id: string) {
    return this.call('admin_duplicate_product', { p_id: id }, s.saveResultSchema);
  }
  deleteProduct(id: string) {
    return this.call('admin_delete_product', { p_id: id }, s.adminResultSchema);
  }
  setVariantPrice(
    variantId: string,
    price: number | null,
    compareAtPrice: number | null,
    reason: string,
    expectedUpdatedAt: string | null,
  ) {
    return this.call(
      'admin_set_variant_price',
      {
        p_variant_id: variantId,
        p_price: price,
        p_compare_at: compareAtPrice,
        p_reason: reason,
        p_expected_updated_at: expectedUpdatedAt,
      },
      z.union([z.object({ ok: z.literal(true), updatedAt: z.string() }), s.adminProblemSchema]),
    );
  }
  bulkUpdateVariants(ids: string[], patch: s.BulkVariantPatch, reason: string) {
    return this.call(
      'admin_bulk_update_variants',
      { p_ids: ids, p_patch: patch, p_reason: reason },
      s.countResultSchema,
    );
  }
  listPriceHistory(filter: s.PriceHistoryFilter) {
    return this.call(
      'admin_list_price_history',
      { p_filter: filter },
      pageOf(s.priceHistoryRowSchema),
    );
  }
  listInventory(filter: s.InventoryFilter) {
    return this.call('admin_list_inventory', { p_filter: filter }, pageOf(s.inventoryRowSchema));
  }
  adjustStock(
    variantId: string,
    type: s.StockAdjustmentType,
    quantity: number,
    reason: string,
    expectedQuantity: number | null,
  ) {
    return this.call(
      'admin_adjust_stock',
      {
        p_variant_id: variantId,
        p_type: type,
        p_quantity: quantity,
        p_reason: reason,
        p_expected_quantity: expectedQuantity,
      },
      s.stockAdjustResultSchema,
    );
  }
  listStockMovements(filter: s.MovementFilter) {
    return this.call(
      'admin_list_stock_movements',
      { p_filter: filter },
      pageOf(s.movementRowSchema),
    );
  }
  listCategories() {
    return this.call('admin_list_categories', {}, s.adminCategorySchema.array());
  }
  saveCategory(input: s.CategoryInput) {
    return this.call('admin_save_category', { p_payload: input }, s.saveResultSchema);
  }
  reorderCategories(parentId: string | null, ids: string[]) {
    return this.call(
      'admin_reorder_categories',
      { p_parent_id: parentId, p_ids: ids },
      s.adminResultSchema,
    );
  }
  deleteCategory(id: string) {
    return this.call('admin_delete_category', { p_id: id }, s.adminResultSchema);
  }
  listBrands() {
    return this.call('admin_list_brands', {}, s.adminBrandSchema.array());
  }
  saveBrand(input: s.BrandInput) {
    return this.call('admin_save_brand', { p_payload: input }, s.saveResultSchema);
  }
  deleteBrand(id: string) {
    return this.call('admin_delete_brand', { p_id: id }, s.adminResultSchema);
  }
  async uploadCatalogMedia(file: Blob, mime: string) {
    const ext = MEDIA_EXT[mime];
    if (!ext) throw new RepositoryError('unsupported media type', null, 'invalid_response');
    const path = `catalog/${crypto.randomUUID()}.${ext}`;
    const { error } = await this.client.storage
      .from('products')
      .upload(path, file, { contentType: mime, upsert: false, cacheControl: '31536000' });
    if (error) throw new RepositoryError('upload failed', error, 'unavailable');
    return { url: this.client.storage.from('products').getPublicUrl(path).data.publicUrl };
  }

  // ── Orders / customers ───────────────────────────────────────────────────
  orderAssignees() {
    return this.call('admin_order_assignees', {}, s.assigneeSchema.array());
  }
  assignOrder(orderId: string, staffId: string | null) {
    return this.call(
      'staff_assign_order',
      { p_order_id: orderId, p_staff_id: staffId },
      s.adminResultSchema,
    );
  }
  listCustomers(filter: s.CustomerFilter) {
    return this.call(
      'admin_list_customers',
      { p_filter: filter },
      pageOf(s.customerListItemSchema),
    );
  }
  getCustomer(id: string) {
    return this.call('admin_get_customer', { p_id: id }, s.customerDetailSchema.nullable());
  }
  saveCustomerNote(
    customerId: string,
    noteId: string | null,
    body: string,
    pinned: boolean,
    expectedUpdatedAt: string | null,
  ) {
    return this.call(
      'admin_save_customer_note',
      {
        p_customer_id: customerId,
        p_note_id: noteId,
        p_body: body,
        p_pinned: pinned,
        p_expected_updated_at: expectedUpdatedAt,
      },
      z.union([
        z.object({ ok: z.literal(true), id: z.string(), updatedAt: z.string() }),
        s.adminProblemSchema,
      ]),
    );
  }
  deleteCustomerNote(noteId: string) {
    return this.call('admin_delete_customer_note', { p_note_id: noteId }, s.adminResultSchema);
  }
  listAbandonedCarts(filter: s.AbandonedCartFilter) {
    return this.call('admin_list_abandoned_carts', { p_filter: filter }, s.abandonedCartPageSchema);
  }
  setCartFollowup(customerId: string, state: s.FollowUpState, note: string | null) {
    return this.call(
      'admin_set_cart_followup',
      { p_customer_id: customerId, p_state: state, p_note: note },
      s.adminResultSchema,
    );
  }

  // ── Services ─────────────────────────────────────────────────────────────
  listServiceRequests(
    kind: Parameters<AdminRepository['listServiceRequests']>[0],
    filter: s.AdminServiceFilter,
  ) {
    return this.call(
      'admin_list_service_requests',
      { p_kind: kind, p_filter: filter },
      s.adminServicePageSchema,
    );
  }
  setServicePriority(id: string, priority: s.ServicePriority) {
    return this.call(
      'admin_set_service_priority',
      { p_id: id, p_priority: priority },
      s.adminResultSchema,
    );
  }
  serviceContext(id: string) {
    return this.call('admin_service_context', { p_id: id }, s.serviceContextSchema.nullable());
  }

  // ── Reviews, waitlists, notifications ────────────────────────────────────
  listReviews(filter: s.AdminReviewFilter) {
    return this.call('admin_list_reviews', { p_filter: filter }, pageOf(s.adminReviewSchema));
  }
  listWaitlist(filter: s.WaitlistFilter) {
    return this.call('admin_list_waitlist', { p_filter: filter }, pageOf(s.waitlistRowSchema));
  }
  notificationAdmin() {
    return this.call('admin_list_notification_templates', {}, s.notificationAdminSchema);
  }
  saveNotificationTemplate(
    key: string,
    title: { ar: string; en: string },
    body: { ar: string; en: string },
    isActive: boolean,
    expectedUpdatedAt: string | null,
  ) {
    return this.call(
      'admin_save_notification_template',
      {
        p_key: key,
        p_title: title,
        p_body: body,
        p_is_active: isActive,
        p_expected_updated_at: expectedUpdatedAt,
      },
      z.union([z.object({ ok: z.literal(true), updatedAt: z.string() }), s.adminProblemSchema]),
    );
  }
  sendNotifications(
    userIds: string[],
    title: { ar: string; en: string },
    body: { ar: string; en: string },
    actionPath: string | null,
  ) {
    return this.call(
      'admin_send_notifications',
      { p_user_ids: userIds, p_title: title, p_body: body, p_action_path: actionPath },
      z.union([z.object({ ok: z.literal(true), sent: intSchema }), s.adminProblemSchema]),
    );
  }
  searchRecipients(q: string) {
    return this.call('admin_search_recipients', { p_q: q }, s.recipientSchema.array());
  }

  // ── Offers, content, sections ────────────────────────────────────────────
  listOffers(filter: s.OfferFilter) {
    return this.call('admin_list_offers', { p_filter: filter }, pageOf(s.offerListItemSchema));
  }
  getOffer(id: string) {
    return this.call('admin_get_offer', { p_id: id }, s.adminOfferSchema.nullable());
  }
  saveOffer(input: s.OfferInput) {
    return this.call('admin_save_offer', { p_payload: input }, s.saveResultSchema);
  }
  setOffersStatus(ids: string[], status: s.ProductStatus) {
    return this.call(
      'admin_set_offers_status',
      { p_ids: ids, p_status: status },
      s.countResultSchema,
    );
  }
  deleteOffer(id: string) {
    return this.call(
      'admin_delete_offer',
      { p_id: id },
      z.union([z.object({ ok: z.literal(true), archived: z.boolean() }), s.adminProblemSchema]),
    );
  }
  listEntries(filter: s.EntryFilter) {
    return this.call('admin_list_entries', { p_filter: filter }, pageOf(s.entryListItemSchema));
  }
  getEntry(id: string) {
    return this.call('admin_get_entry', { p_id: id }, s.adminEntrySchema.nullable());
  }
  saveEntry(input: s.EntryInput) {
    return this.call('admin_save_entry', { p_payload: input }, s.saveResultSchema);
  }
  setEntriesStatus(ids: string[], status: s.ProductStatus) {
    return this.call(
      'admin_set_entries_status',
      { p_ids: ids, p_status: status },
      s.countResultSchema,
    );
  }
  deleteEntry(id: string) {
    return this.call('admin_delete_entry', { p_id: id }, s.adminResultSchema);
  }
  listPageSections(pageKey: string) {
    return this.call(
      'admin_list_page_sections',
      { p_page_key: pageKey },
      s.adminSectionSchema.array(),
    );
  }
  savePageSection(
    id: string,
    isVisible: boolean,
    props: Record<string, unknown>,
    expectedUpdatedAt: string | null,
  ) {
    return this.call(
      'admin_save_page_section',
      {
        p_id: id,
        p_is_visible: isVisible,
        p_props: props,
        p_expected_updated_at: expectedUpdatedAt,
      },
      z.union([z.object({ ok: z.literal(true), updatedAt: z.string() }), s.adminProblemSchema]),
    );
  }

  // ── Insights & data ──────────────────────────────────────────────────────
  dashboard(from: string, to: string, includeDemo: boolean) {
    return this.call(
      'admin_dashboard',
      { p_from: from, p_to: to, p_include_demo: includeDemo },
      s.dashboardSchema,
    );
  }
  analytics(from: string, to: string, includeDemo: boolean) {
    return this.call(
      'admin_analytics',
      { p_from: from, p_to: to, p_include_demo: includeDemo },
      s.analyticsSchema,
    );
  }
  exportData(kind: s.ExportKind, filter: Record<string, unknown> = {}) {
    return this.call('admin_export', { p_kind: kind, p_filter: filter }, s.exportResultSchema);
  }
  exportBackup() {
    return this.call('admin_export_backup', {}, z.record(z.string(), z.unknown()));
  }
  importPreview(fileName: string, rows: Record<string, string | undefined>[]) {
    return this.call(
      'admin_import_preview',
      { p_file_name: fileName, p_rows: rows },
      s.importPreviewSchema,
    );
  }
  importCommit(jobId: string, validOnly: boolean) {
    return this.call(
      'admin_import_commit',
      { p_job_id: jobId, p_valid_only: validOnly },
      s.importCommitSchema,
    );
  }
  listImportJobs() {
    return this.call('admin_list_import_jobs', {}, s.importJobSchema.array());
  }
}
