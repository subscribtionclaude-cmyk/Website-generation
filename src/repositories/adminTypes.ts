import type {
  AbandonedCartFilter,
  AccountLookup,
  AdminBrand,
  AdminCategory,
  AdminEntry,
  AdminOffer,
  AdminProduct,
  AdminResult,
  AdminReview,
  AdminReviewFilter,
  AdminRole,
  AdminSection,
  AdminServiceFilter,
  AdminServicePage,
  Analytics,
  Assignee,
  AuditDetail,
  AuditFilter,
  AuditRow,
  BrandInput,
  BulkVariantPatch,
  CatalogLookups,
  CategoryInput,
  CountResult,
  CustomerDetail,
  CustomerFilter,
  CustomerListItem,
  Dashboard,
  EntryFilter,
  EntryInput,
  EntryListItem,
  ExportKind,
  ExportResult,
  FollowUpState,
  ImportCommit,
  ImportJob,
  ImportPreview,
  InventoryFilter,
  InventoryRow,
  MovementFilter,
  MovementRow,
  NotificationAdmin,
  OfferFilter,
  OfferInput,
  OfferListItem,
  PriceHistoryFilter,
  PriceHistoryRow,
  ProductFilter,
  ProductInput,
  ProductListItem,
  ProductStateAction,
  ProductStatus,
  Recipient,
  SaveResult,
  ServiceContext,
  ServicePriority,
  SettingOverview,
  SettingVersion,
  StaffMember,
  StockAdjustResult,
  StockAdjustmentType,
  WaitlistFilter,
  WaitlistRow,
  AbandonedCartRow,
} from '@/domain/admin/schemas';
import type { ImportField } from '@/domain/admin/importMapping';
import type { LocalizedText } from '@/domain/localized';
import type { ServiceKind } from '@/domain/services/types';

export interface Page<T> {
  total: number;
  items: T[];
}

/**
 * Phase 06 admin control center port. Every method maps 1:1 to a permission-checked, audited
 * database RPC (supabase/migrations/20260929*_admin_*.sql); the demo adapter mirrors the same
 * rules in this browser. Business refusals come back as `{ ok: false, code }`; permission
 * refusals throw RepositoryError('forbidden').
 */
export interface AdminRepository {
  // ── System: activity, settings, audit, staff & roles, demo data ──────────
  touchActivity(): Promise<void>;
  settingsOverview(): Promise<SettingOverview[]>;
  settingVersions(key: string, limit?: number): Promise<SettingVersion[]>;
  saveSettingDraft(
    key: string,
    value: Record<string, unknown>,
    expectedDraftAt: string | null,
  ): Promise<AdminResult<{ draftUpdatedAt: string; baseVersion: number | null }>>;
  discardSettingDraft(key: string): Promise<void>;
  /** `force` publishes over a draft that was based on an older published version. */
  publishSetting(
    key: string,
    note: string | null,
    force?: boolean,
  ): Promise<AdminResult<{ version: number }>>;
  rollbackSetting(
    key: string,
    version: number,
    note: string | null,
  ): Promise<AdminResult<{ version: number }>>;
  listAuditLogs(filter: AuditFilter): Promise<Page<AuditRow>>;
  getAuditLog(id: number): Promise<AuditDetail | null>;
  listStaff(filter?: {
    q?: string | null;
    status?: 'active' | 'suspended' | null;
  }): Promise<StaffMember[]>;
  lookupAccount(email: string): Promise<AccountLookup>;
  changeStaffRole(
    userId: string,
    fromRole: string | null,
    toRole: string | null,
  ): Promise<AdminResult>;
  setStaffSuspended(
    userId: string,
    suspended: boolean,
    reason: string | null,
  ): Promise<AdminResult>;
  listRoles(): Promise<AdminRole[]>;
  setRolePermissions(roleKey: string, permissions: string[]): Promise<AdminResult>;
  demoSummary(): Promise<Record<string, number>>;
  deleteDemoData(): Promise<Record<string, number>>;
  /** Demo mode only: discard this browser's demo changes and start again from the seed. */
  resetDemoData?(): Promise<void>;

  // ── Catalog ──────────────────────────────────────────────────────────────
  catalogLookups(): Promise<CatalogLookups>;
  listProducts(filter: ProductFilter): Promise<Page<ProductListItem>>;
  getProduct(id: string): Promise<AdminProduct | null>;
  saveProduct(input: ProductInput): Promise<SaveResult>;
  setProductsState(ids: string[], action: ProductStateAction): Promise<CountResult>;
  duplicateProduct(id: string): Promise<SaveResult>;
  deleteProduct(id: string): Promise<AdminResult>;
  setVariantPrice(
    variantId: string,
    price: number | null,
    compareAtPrice: number | null,
    reason: string,
    expectedUpdatedAt: string | null,
  ): Promise<AdminResult<{ updatedAt: string }>>;
  bulkUpdateVariants(ids: string[], patch: BulkVariantPatch, reason: string): Promise<CountResult>;
  listPriceHistory(filter: PriceHistoryFilter): Promise<Page<PriceHistoryRow>>;
  listInventory(filter: InventoryFilter): Promise<Page<InventoryRow>>;
  adjustStock(
    variantId: string,
    type: StockAdjustmentType,
    quantity: number,
    reason: string,
    expectedQuantity: number | null,
  ): Promise<StockAdjustResult>;
  listStockMovements(filter: MovementFilter): Promise<Page<MovementRow>>;
  listCategories(): Promise<AdminCategory[]>;
  saveCategory(input: CategoryInput): Promise<SaveResult>;
  reorderCategories(parentId: string | null, ids: string[]): Promise<AdminResult>;
  deleteCategory(id: string): Promise<AdminResult>;
  listBrands(): Promise<AdminBrand[]>;
  saveBrand(input: BrandInput): Promise<SaveResult>;
  deleteBrand(id: string): Promise<AdminResult>;
  /** Upload a (compressed) product/brand/content image; returns its public URL. */
  uploadCatalogMedia(file: Blob, mime: string): Promise<{ url: string }>;

  // ── Orders / customers ───────────────────────────────────────────────────
  orderAssignees(): Promise<Assignee[]>;
  assignOrder(orderId: string, staffId: string | null): Promise<AdminResult>;
  listCustomers(filter: CustomerFilter): Promise<Page<CustomerListItem>>;
  getCustomer(id: string): Promise<CustomerDetail | null>;
  saveCustomerNote(
    customerId: string,
    noteId: string | null,
    body: string,
    pinned: boolean,
    expectedUpdatedAt: string | null,
  ): Promise<AdminResult<{ id: string; updatedAt: string }>>;
  deleteCustomerNote(noteId: string): Promise<AdminResult>;
  listAbandonedCarts(filter: AbandonedCartFilter): Promise<
    Page<AbandonedCartRow> & {
      settings: { enabled: boolean; thresholdHours: number; followUp: string };
    }
  >;
  setCartFollowup(
    customerId: string,
    state: FollowUpState,
    note: string | null,
  ): Promise<AdminResult>;

  // ── Service queues ───────────────────────────────────────────────────────
  listServiceRequests(kind: ServiceKind, filter: AdminServiceFilter): Promise<AdminServicePage>;
  setServicePriority(id: string, priority: ServicePriority): Promise<AdminResult>;
  serviceContext(id: string): Promise<ServiceContext | null>;

  // ── Reviews, waitlists, notifications ────────────────────────────────────
  listReviews(filter: AdminReviewFilter): Promise<Page<AdminReview>>;
  listWaitlist(filter: WaitlistFilter): Promise<Page<WaitlistRow>>;
  notificationAdmin(): Promise<NotificationAdmin>;
  saveNotificationTemplate(
    key: string,
    title: LocalizedText,
    body: LocalizedText,
    isActive: boolean,
    expectedUpdatedAt: string | null,
  ): Promise<AdminResult<{ updatedAt: string }>>;
  sendNotifications(
    userIds: string[],
    title: LocalizedText,
    body: LocalizedText,
    actionPath: string | null,
  ): Promise<AdminResult<{ sent: number }>>;
  searchRecipients(q: string): Promise<Recipient[]>;

  // ── Offers, content, homepage sections ───────────────────────────────────
  listOffers(filter: OfferFilter): Promise<Page<OfferListItem>>;
  getOffer(id: string): Promise<AdminOffer | null>;
  saveOffer(input: OfferInput): Promise<SaveResult>;
  setOffersStatus(ids: string[], status: ProductStatus): Promise<CountResult>;
  deleteOffer(id: string): Promise<AdminResult<{ archived: boolean }>>;
  listEntries(filter: EntryFilter): Promise<Page<EntryListItem>>;
  getEntry(id: string): Promise<AdminEntry | null>;
  saveEntry(input: EntryInput): Promise<SaveResult>;
  setEntriesStatus(ids: string[], status: ProductStatus): Promise<CountResult>;
  deleteEntry(id: string): Promise<AdminResult>;
  listPageSections(pageKey: string): Promise<AdminSection[]>;
  savePageSection(
    id: string,
    isVisible: boolean,
    props: Record<string, unknown>,
    expectedUpdatedAt: string | null,
  ): Promise<AdminResult<{ updatedAt: string }>>;

  // ── Insights & data ──────────────────────────────────────────────────────
  dashboard(from: string, to: string, includeDemo: boolean): Promise<Dashboard>;
  analytics(from: string, to: string, includeDemo: boolean): Promise<Analytics>;
  exportData(kind: ExportKind, filter?: Record<string, unknown>): Promise<ExportResult>;
  exportBackup(): Promise<Record<string, unknown>>;
  importPreview(
    fileName: string,
    rows: Partial<Record<ImportField, string>>[],
  ): Promise<ImportPreview>;
  importCommit(jobId: string, validOnly: boolean): Promise<ImportCommit>;
  listImportJobs(): Promise<ImportJob[]>;
}
