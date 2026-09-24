import type { AccessProfile } from '@/domain/access/access';
import type {
  Brand,
  CatalogPage,
  CatalogQuery,
  Category,
  ProductDetail,
} from '@/domain/catalog/types';
import type { ContentEntry, ContentType, Offer, PageSection } from '@/domain/content/types';
import type { RoleDefinition } from '@/domain/access/permissions';
import type { SettingRecord } from '@/domain/settings/resolve';
import type { Locale } from '@/i18n/config';

/**
 * Repository ports. UI and features depend only on these interfaces; the concrete adapter
 * (demo seed data or Supabase) is chosen once at boot from the explicit data mode.
 * A future backend (or an ERP/POS sync layer) implements the same ports.
 */
export interface SettingsRepository {
  /** Published values of public settings (drafts are never returned). */
  listPublishedSettings(): Promise<SettingRecord[]>;
}

export interface AccessRepository {
  /** Effective access of the signed-in user; null when signed out. */
  getMyAccess(): Promise<AccessProfile | null>;
  /** Role definitions with their permissions (staff only). */
  listRoles(): Promise<RoleDefinition[]>;
}

export interface Profile {
  id: string;
  email: string | null;
  fullName: string | null;
  phone: string | null;
  preferredLocale: Locale;
  adminLocale: Locale | null;
}

export interface ProfilePreferencesUpdate {
  preferredLocale?: Locale;
  adminLocale?: Locale;
}

export interface ProfileRepository {
  getMyProfile(): Promise<Profile | null>;
  updateMyPreferences(update: ProfilePreferencesUpdate): Promise<void>;
}

/** Storefront catalog reads. Only published rows; exact stock quantities are never exposed. */
export interface CatalogRepository {
  listBrands(): Promise<Brand[]>;
  listCategories(): Promise<Category[]>;
  /** Server-side search/filter/sort/paginate (never loads the whole catalog into the browser). */
  search(query: CatalogQuery): Promise<CatalogPage>;
  getProduct(slug: string): Promise<ProductDetail | null>;
}

export interface EntryFilter {
  types?: ContentType[];
  featuredOnly?: boolean;
  limit?: number;
}

/** Published CMS content: page sections, active offers and content entries. */
export interface ContentRepository {
  listPageSections(pageKey: string): Promise<PageSection[]>;
  listOffers(): Promise<Offer[]>;
  getOffer(slug: string): Promise<Offer | null>;
  listEntries(filter?: EntryFilter): Promise<ContentEntry[]>;
  getEntry(slug: string): Promise<ContentEntry | null>;
}

export interface StockAlertRequest {
  productSlug: string;
  variantSku: string | null;
  name: string;
  phone: string;
  email: string | null;
  locale: Locale;
}

export interface WaitlistRequest {
  productSlug: string;
  name: string;
  phone: string;
  email: string | null;
  desiredStorage: string | null;
  desiredColor: string | null;
  locale: Locale;
}

export interface RequestResult {
  status: 'created' | 'duplicate';
}

/**
 * Customer "notify me" / waitlist requests. Phase 02 persists requests; staff follow-up and
 * automatic notifications arrive in Phases 04/06.
 */
export interface CustomerRequestsRepository {
  requestStockAlert(request: StockAlertRequest): Promise<RequestResult>;
  joinWaitlist(request: WaitlistRequest): Promise<RequestResult>;
}

export interface Repositories {
  settings: SettingsRepository;
  access: AccessRepository;
  profiles: ProfileRepository;
  catalog: CatalogRepository;
  content: ContentRepository;
  requests: CustomerRequestsRepository;
}
