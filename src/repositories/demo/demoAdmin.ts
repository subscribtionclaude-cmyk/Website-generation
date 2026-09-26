import type { AdminActor } from '@/domain/admin/demo/demoAdmin';
import type { ImportField } from '@/domain/admin/importMapping';
import type * as s from '@/domain/admin/schemas';
import type { LocalizedText } from '@/domain/localized';
import type { ServiceKind } from '@/domain/services/types';
import type { DemoAuthService } from '@/services/auth/demoAuthService';
import { RepositoryError } from '../supabase/errors';
import type { AdminRepository } from '../adminTypes';
import { actorOf, guard, type DemoCommerceStore, DemoCommerceStore as Store } from './demoCommerce';

/** Simulated latency keeps loading states honest during demo previews. */
const delay = (ms = 140) => new Promise((resolve) => setTimeout(resolve, ms));
/** Demo uploads are kept inline in this browser; larger files would exhaust localStorage. */
const MAX_DEMO_MEDIA_BYTES = 450_000;

const forbidden = () => new RepositoryError('forbidden', null, 'forbidden');

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * DEMO MODE ONLY — AdminRepository over the in-browser admin engine (src/domain/admin/demo).
 * Same permission rules, validation codes and stale-edit detection as the database RPCs.
 */
export class DemoAdminRepository implements AdminRepository {
  private readonly store: DemoCommerceStore;
  private readonly auth: DemoAuthService;

  constructor(store: DemoCommerceStore, auth: DemoAuthService) {
    this.store = store;
    this.auth = auth;
  }

  private get admin() {
    return this.store.admin;
  }

  private async run<T>(fn: (actor: AdminActor) => T, ms = 140): Promise<T> {
    await delay(ms);
    const actor = await actorOf(this.auth, this.store);
    if (!actor.userId) throw forbidden();
    return guard(() => fn(actor));
  }

  /** Engines that return 'forbidden' instead of throwing (settings store). */
  private async settingsCall<T>(fn: (actor: AdminActor) => T | 'forbidden'): Promise<T> {
    const result = await this.run(fn);
    if (result === 'forbidden') throw forbidden();
    return result;
  }

  private async accessCall(fn: (actor: AdminActor) => s.AdminResult) {
    const result = await this.run(fn, 200);
    if (!result.ok && result.code === 'forbidden') throw forbidden();
    return result;
  }

  // ── System ───────────────────────────────────────────────────────────────
  async touchActivity() {
    const actor = await actorOf(this.auth, this.store);
    if (actor.roles.length) this.store.access.touch(actor.userId);
  }
  settingsOverview() {
    return this.settingsCall((a) => this.store.settings.overview(a));
  }
  settingVersions(key: string, limit = 30) {
    return this.settingsCall((a) => this.store.settings.versions(a, key, limit));
  }
  async saveSettingDraft(
    key: string,
    value: Record<string, unknown>,
    expectedDraftAt: string | null,
  ) {
    return this.settingsCall((a) => this.store.settings.saveDraft(a, key, value, expectedDraftAt));
  }
  async discardSettingDraft(key: string) {
    await this.settingsCall((a) => this.store.settings.discard(a, key));
  }
  async publishSetting(key: string, note: string | null, force = false) {
    const result = await this.settingsCall((a) => this.store.settings.publish(a, key, note, force));
    if (result.ok)
      await this.auditSetting('setting.published', key, { version: result.version, note });
    return result;
  }
  async rollbackSetting(key: string, version: number, note: string | null) {
    const result = await this.settingsCall((a) =>
      this.store.settings.rollback(a, key, version, note),
    );
    if (result.ok)
      await this.auditSetting('setting.rolled_back', key, {
        toVersion: version,
        version: result.version,
      });
    return result;
  }
  private async auditSetting(action: string, key: string, detail: Record<string, unknown>) {
    const actor = await actorOf(this.auth, this.store);
    this.admin.audit(actor, action, 'public.site_settings', key, detail);
  }
  listAuditLogs(filter: s.AuditFilter) {
    return this.run((a) => this.admin.data.listAuditLogs(a, filter));
  }
  getAuditLog(id: number) {
    return this.run((a) => this.admin.data.getAuditLog(a, id));
  }
  listStaff(filter: { q?: string | null; status?: 'active' | 'suspended' | null } = {}) {
    return this.run((a) => this.admin.data.listStaff(a, filter));
  }
  lookupAccount(email: string) {
    return this.run((a) => this.admin.data.lookupAccount(a, email));
  }
  async changeStaffRole(userId: string, fromRole: string | null, toRole: string | null) {
    const result = await this.accessCall((a) =>
      this.store.access.changeRole(a, userId, fromRole, toRole),
    );
    if (result.ok) {
      const actor = await actorOf(this.auth, this.store);
      this.admin.audit(actor, 'access.role_changed', 'public.profiles', userId, {
        from: fromRole,
        to: toRole,
      });
    }
    return result;
  }
  async setStaffSuspended(userId: string, suspended: boolean, reason: string | null) {
    const result = await this.accessCall((a) =>
      this.store.access.setSuspended(a, userId, suspended, reason),
    );
    if (result.ok) {
      const actor = await actorOf(this.auth, this.store);
      this.admin.audit(
        actor,
        suspended ? 'staff.suspended' : 'staff.reactivated',
        'public.profiles',
        userId,
        {
          reason,
        },
      );
    }
    return result;
  }
  listRoles() {
    return this.run((a) => {
      if (!a.can('users.view') && !a.can('roles.manage')) throw forbidden();
      const staff = this.admin.data.listStaff({ ...a, can: () => true }, {});
      return this.store.access.roles().map((r): s.AdminRole => ({
        key: r.key,
        name: r.name,
        description: null,
        rank: r.rank,
        grantsAll: r.grantsAll,
        isSystem: r.isSystem,
        editable: a.can('roles.manage') && !r.grantsAll && (a.grantsAll || r.rank < a.rank),
        permissions: r.grantsAll ? [] : r.permissions,
        users: staff
          .filter((m) => m.roles.some((x) => x.key === r.key))
          .map((m) => ({
            id: m.id,
            email: m.email,
            name: m.name,
            suspended: m.status === 'suspended',
          })),
      }));
    });
  }
  async setRolePermissions(roleKey: string, permissions: string[]) {
    const result = await this.accessCall((a) =>
      this.store.access.setRolePermissions(a, roleKey, permissions),
    );
    if (result.ok) {
      const actor = await actorOf(this.auth, this.store);
      this.admin.audit(actor, 'access.role_permissions_set', 'public.roles', roleKey, {
        permissions,
      });
    }
    return result;
  }
  demoSummary() {
    return this.run((a) => {
      if (!a.can('demo.manage') && !a.can('dashboard.view')) throw forbidden();
      return this.admin.demoSummary();
    });
  }
  async deleteDemoData() {
    const summary = await this.run((a) => {
      if (!a.can('demo.manage')) throw forbidden();
      const counts = this.admin.demoSummary();
      this.admin.audit(a, 'demo.delete_all', 'demo_data', null, { deleted: counts });
      return counts;
    });
    Store.resetBrowserData({ emptyCatalog: true });
    return summary;
  }
  /** Demo only: forget every change made in this browser and start again from the seed. */
  async resetDemoData() {
    await this.run((a) => {
      if (!a.can('demo.manage')) throw forbidden();
    });
    Store.resetBrowserData();
  }

  // ── Catalog ──────────────────────────────────────────────────────────────
  catalogLookups() {
    return this.run((a) => this.admin.catalog.lookups(a));
  }
  listProducts(filter: s.ProductFilter) {
    return this.run((a) => this.admin.catalog.listProducts(a, filter));
  }
  getProduct(id: string) {
    return this.run((a) => this.admin.catalog.getProduct(a, id));
  }
  saveProduct(input: s.ProductInput) {
    return this.run((a) => this.admin.catalog.saveProduct(a, input), 300);
  }
  setProductsState(ids: string[], action: s.ProductStateAction) {
    return this.run((a) => this.admin.catalog.setProductsState(a, ids, action), 200);
  }
  duplicateProduct(id: string) {
    return this.run((a) => this.admin.catalog.duplicateProduct(a, id), 250);
  }
  deleteProduct(id: string) {
    return this.run((a) => this.admin.catalog.deleteProduct(a, id), 200);
  }
  setVariantPrice(
    variantId: string,
    price: number | null,
    compareAtPrice: number | null,
    reason: string,
    expectedUpdatedAt: string | null,
  ) {
    return this.run(
      (a) =>
        this.admin.catalog.setVariantPrice(
          a,
          variantId,
          price,
          compareAtPrice,
          reason,
          expectedUpdatedAt,
        ),
      200,
    );
  }
  bulkUpdateVariants(ids: string[], patch: s.BulkVariantPatch, reason: string) {
    return this.run((a) => this.admin.catalog.bulkUpdateVariants(a, ids, patch, reason), 250);
  }
  listPriceHistory(filter: s.PriceHistoryFilter) {
    return this.run((a) => this.admin.catalog.listPriceHistory(a, filter));
  }
  listInventory(filter: s.InventoryFilter) {
    return this.run((a) => this.admin.catalog.listInventory(a, filter));
  }
  adjustStock(
    variantId: string,
    type: s.StockAdjustmentType,
    quantity: number,
    reason: string,
    expectedQuantity: number | null,
  ) {
    return this.run(
      (a) => this.admin.catalog.adjustStock(a, variantId, type, quantity, reason, expectedQuantity),
      200,
    );
  }
  listStockMovements(filter: s.MovementFilter) {
    return this.run((a) => this.admin.catalog.listStockMovements(a, filter));
  }
  listCategories() {
    return this.run((a) => this.admin.catalog.listCategories(a));
  }
  saveCategory(input: s.CategoryInput) {
    return this.run((a) => this.admin.catalog.saveCategory(a, input), 200);
  }
  reorderCategories(parentId: string | null, ids: string[]) {
    return this.run((a) => this.admin.catalog.reorderCategories(a, parentId, ids), 150);
  }
  deleteCategory(id: string) {
    return this.run((a) => this.admin.catalog.deleteCategory(a, id), 200);
  }
  listBrands() {
    return this.run((a) => this.admin.catalog.listBrands(a));
  }
  saveBrand(input: s.BrandInput) {
    return this.run((a) => this.admin.catalog.saveBrand(a, input), 200);
  }
  deleteBrand(id: string) {
    return this.run((a) => this.admin.catalog.deleteBrand(a, id), 200);
  }
  async uploadCatalogMedia(file: Blob, mime: string) {
    await this.run((a) => {
      if (!a.can('catalog.manage') && !a.can('marketing.manage') && !a.can('content.manage'))
        throw forbidden();
    }, 250);
    if (!mime.startsWith('image/'))
      throw new RepositoryError('Demo previews store images only', null, 'invalid_response');
    if (file.size > MAX_DEMO_MEDIA_BYTES)
      throw new RepositoryError('Image too large for the demo preview', null, 'invalid_response');
    return { url: await blobToDataUrl(file) };
  }

  // ── Orders / customers ───────────────────────────────────────────────────
  orderAssignees() {
    return this.run((a) => this.admin.ops.orderAssignees(a));
  }
  assignOrder(orderId: string, staffId: string | null) {
    return this.run((a) => this.admin.ops.assignOrder(a, orderId, staffId), 200);
  }
  listCustomers(filter: s.CustomerFilter) {
    return this.run((a) => this.admin.ops.listCustomers(a, filter));
  }
  getCustomer(id: string) {
    return this.run((a) => this.admin.ops.getCustomer(a, id));
  }
  saveCustomerNote(
    customerId: string,
    noteId: string | null,
    body: string,
    pinned: boolean,
    expectedUpdatedAt: string | null,
  ) {
    return this.run(
      (a) =>
        this.admin.ops.saveCustomerNote(a, customerId, noteId, body, pinned, expectedUpdatedAt),
      200,
    );
  }
  deleteCustomerNote(noteId: string) {
    return this.run((a) => this.admin.ops.deleteCustomerNote(a, noteId), 200);
  }
  listAbandonedCarts(filter: s.AbandonedCartFilter) {
    return this.run((a) => this.admin.ops.listAbandonedCarts(a, filter));
  }
  setCartFollowup(customerId: string, state: s.FollowUpState, note: string | null) {
    return this.run((a) => this.admin.ops.setCartFollowup(a, customerId, state, note), 200);
  }

  // ── Services ─────────────────────────────────────────────────────────────
  listServiceRequests(kind: ServiceKind, filter: s.AdminServiceFilter) {
    return this.run((a) => this.admin.ops.listServiceRequests(a, kind, filter));
  }
  setServicePriority(id: string, priority: s.ServicePriority) {
    return this.run((a) => this.admin.ops.setServicePriority(a, id, priority), 200);
  }
  serviceContext(id: string) {
    return this.run((a) => this.admin.ops.serviceContext(a, id));
  }

  // ── Reviews, waitlists, notifications ────────────────────────────────────
  listReviews(filter: s.AdminReviewFilter) {
    return this.run((a) => this.admin.ops.listReviews(a, filter));
  }
  listWaitlist(filter: s.WaitlistFilter) {
    return this.run((a) => this.admin.ops.listWaitlist(a, filter));
  }
  notificationAdmin() {
    return this.run((a) => this.admin.ops.notificationAdmin(a));
  }
  saveNotificationTemplate(
    key: string,
    title: LocalizedText,
    body: LocalizedText,
    isActive: boolean,
    expectedUpdatedAt: string | null,
  ) {
    return this.run(
      (a) => this.admin.ops.saveTemplate(a, key, title, body, isActive, expectedUpdatedAt),
      200,
    );
  }
  sendNotifications(
    userIds: string[],
    title: LocalizedText,
    body: LocalizedText,
    actionPath: string | null,
  ) {
    return this.run(
      (a) => this.admin.ops.sendNotifications(a, userIds, title, body, actionPath),
      250,
    );
  }
  searchRecipients(q: string) {
    return this.run((a) => this.admin.ops.searchRecipients(a, q), 100);
  }

  // ── Offers, content, sections ────────────────────────────────────────────
  listOffers(filter: s.OfferFilter) {
    return this.run((a) => this.admin.content.listOffers(a, filter));
  }
  getOffer(id: string) {
    return this.run((a) => this.admin.content.getOffer(a, id));
  }
  saveOffer(input: s.OfferInput) {
    return this.run((a) => this.admin.content.saveOffer(a, input), 250);
  }
  setOffersStatus(ids: string[], status: s.ProductStatus) {
    return this.run((a) => this.admin.content.setOffersStatus(a, ids, status), 200);
  }
  deleteOffer(id: string) {
    return this.run((a) => this.admin.content.deleteOffer(a, id), 200);
  }
  listEntries(filter: s.EntryFilter) {
    return this.run((a) => this.admin.content.listEntries(a, filter));
  }
  getEntry(id: string) {
    return this.run((a) => this.admin.content.getEntry(a, id));
  }
  saveEntry(input: s.EntryInput) {
    return this.run((a) => this.admin.content.saveEntry(a, input), 250);
  }
  setEntriesStatus(ids: string[], status: s.ProductStatus) {
    return this.run((a) => this.admin.content.setEntriesStatus(a, ids, status), 200);
  }
  deleteEntry(id: string) {
    return this.run((a) => this.admin.content.deleteEntry(a, id), 200);
  }
  listPageSections(pageKey: string) {
    return this.run((a) => this.admin.content.listPageSections(a, pageKey));
  }
  savePageSection(
    id: string,
    isVisible: boolean,
    props: Record<string, unknown>,
    expectedUpdatedAt: string | null,
  ) {
    return this.run(
      (a) => this.admin.content.savePageSection(a, id, isVisible, props, expectedUpdatedAt),
      200,
    );
  }

  // ── Insights & data ──────────────────────────────────────────────────────
  dashboard(from: string, to: string, includeDemo: boolean) {
    return this.run((a) => this.admin.data.dashboard(a, from, to, includeDemo), 200);
  }
  analytics(from: string, to: string, includeDemo: boolean) {
    return this.run((a) => this.admin.data.analytics(a, from, to, includeDemo), 200);
  }
  exportData(kind: s.ExportKind, filter: Record<string, unknown> = {}) {
    return this.run((a) => this.admin.data.exportData(a, kind, filter), 250);
  }
  exportBackup() {
    return this.run((a) => this.admin.data.exportBackup(a), 300);
  }
  importPreview(fileName: string, rows: Partial<Record<ImportField, string>>[]) {
    return this.run((a) => this.admin.data.importPreview(a, fileName, rows), 350);
  }
  importCommit(jobId: string, validOnly: boolean) {
    return this.run((a) => this.admin.data.importCommit(a, jobId, validOnly), 400);
  }
  listImportJobs() {
    return this.run((a) => this.admin.data.listImportJobs(a));
  }
}
