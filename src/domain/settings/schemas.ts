import { z } from 'zod';
import { EDITABLE_COLOR_TOKEN_KEYS } from '@/features/theme/editableTokens';
import { isDialablePhone } from '@/lib/phone';
import { isValidClockTime } from '@/lib/time/openingHours';
import { localizedTextSchema } from '@/domain/localized';

/** Internal path ("/store") or absolute https URL. Rejects javascript:, data:, protocol-relative, etc. */
export function isSafeHref(value: string): boolean {
  if (value.startsWith('/')) return !value.startsWith('//');
  try {
    const url = new URL(value);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

const safeHrefSchema = z
  .string()
  .trim()
  .min(1)
  .refine(isSafeHref, 'Must be an internal path or https URL');
const httpsUrlSchema = z
  .string()
  .trim()
  .refine((v) => {
    try {
      return new URL(v).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'Must be an https URL');
const phoneSchema = z.string().trim().refine(isDialablePhone, 'Invalid Egyptian phone number');
const clockTimeSchema = z.string().refine(isValidClockTime, 'Expected HH:MM (24h)');
const weekdaySchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
]);
const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected #RRGGBB');

// ── brand ────────────────────────────────────────────────
export const brandSettingsSchema = z.strictObject({
  name: z.string().trim().min(1).max(60),
  tagline: localizedTextSchema,
  logo: z.strictObject({
    src: z
      .string()
      .trim()
      .refine((v) => v.startsWith('/brand/') || v.startsWith('https://'), {
        message: 'Logo must be a bundled /brand/ asset or an https URL',
      }),
    alt: localizedTextSchema,
  }),
});

// ── theme (Design Studio overrides) ──────────────────────
export const themeSettingsSchema = z.strictObject({
  tokens: z.partialRecord(
    z.enum(EDITABLE_COLOR_TOKEN_KEYS as [string, ...string[]]),
    hexColorSchema,
  ),
});

// ── navigation ───────────────────────────────────────────
export const NAV_ICON_KEYS = [
  'home',
  'apple',
  'store',
  'offers',
  'new',
  'trade-in',
  'repairs',
  'used',
  'news',
  'contact',
  'cart',
  'account',
] as const;
export type NavIconKey = (typeof NAV_ICON_KEYS)[number];

export const navItemSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  label: localizedTextSchema,
  href: safeHrefSchema,
  icon: z.enum(NAV_ICON_KEYS).optional(),
  visible: z.boolean(),
  /** Promoted items (e.g. Trade-In, Repairs) get prominent tiles in the mobile menu. */
  highlight: z.boolean(),
});

export const navigationSettingsSchema = z.strictObject({
  primary: z.array(navItemSchema).max(16),
  mobileTabBar: z.array(navItemSchema).max(5),
});

// ── store details ────────────────────────────────────────
export const openingHoursRuleSchema = z.strictObject({
  days: z.array(weekdaySchema).min(1),
  open: clockTimeSchema,
  close: clockTimeSchema,
});

export const branchSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  name: localizedTextSchema,
  address: localizedTextSchema,
  landmark: localizedTextSchema.nullable(),
  city: localizedTextSchema,
  phones: z.array(phoneSchema).min(1),
  openingHours: z.array(openingHoursRuleSchema),
  mapsUrl: httpsUrlSchema.nullable(),
  pickupEnabled: z.boolean(),
});

export const storeSettingsSchema = z.strictObject({
  branches: z.array(branchSchema).min(1),
  /** Only set when the owner configures it — never assumed from the branch phone numbers. */
  whatsappNumber: phoneSchema.nullable(),
  email: z.email().nullable(),
});

// ── social links ─────────────────────────────────────────
export const socialSettingsSchema = z.strictObject({
  instagram: httpsUrlSchema.nullable(),
  facebook: httpsUrlSchema.nullable(),
  tiktok: httpsUrlSchema.nullable(),
  telegram: httpsUrlSchema.nullable(),
});

// ── localization ─────────────────────────────────────────
export const localizationSettingsSchema = z.strictObject({
  numerals: z.enum(['latn', 'arab']),
  currency: z.literal('EGP'),
  timeZone: z.literal('Africa/Cairo'),
  weekStartsOn: weekdaySchema,
});

// ── feature toggles (optional systems ship disabled) ─────
export const featuresSettingsSchema = z.strictObject({
  promoCodes: z.boolean(),
  loyalty: z.boolean(),
  /**
   * Staging only: let the LIVE storefront show rows flagged is_demo (always labelled "Demo").
   * Off by default, so demo products never appear as live inventory.
   */
  showDemoCatalog: z.boolean().default(false),
});

// ── trust items (homepage strip, Apple page badge…) ──────
export const TRUST_ICON_KEYS = [
  'apple',
  'shield',
  'truck',
  'store',
  'refresh',
  'wrench',
  'badge',
] as const;

export const trustItemSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]{1,60}$/),
  icon: z.enum(TRUST_ICON_KEYS),
  title: localizedTextSchema,
  body: localizedTextSchema.nullable(),
  visible: z.boolean(),
});

export const trustSettingsSchema = z.strictObject({
  items: z.array(trustItemSchema).max(12),
});

// ── catalog presentation ─────────────────────────────────
export const catalogSettingsSchema = z.strictObject({
  pageSize: z.number().int().min(4).max(48),
  budgetPresets: z
    .array(z.strictObject({ min: z.number().min(0), max: z.number().positive().nullable() }))
    .max(8),
  budgetStep: z.number().int().min(50).max(10_000),
});

// ── commerce (public: checkout rules customers need to see) ─
export const instapaySettingsSchema = z.strictObject({
  /** InstaPay handle / IPA exactly as supplied by the owner — never invented. */
  handle: z.string().trim().min(3).max(80),
  accountName: localizedTextSchema.nullable(),
  instructions: localizedTextSchema.nullable(),
});

export const commerceSettingsSchema = z.strictObject({
  /** Soft stock reservation after checkout (minutes). */
  reservationMinutes: z.number().int().min(5).max(1440),
  maxQuantityPerLine: z.number().int().min(1).max(99),
  /** Unconfirmed orders one customer may hold at once (limits reservation abuse). */
  maxOpenOrdersPerCustomer: z.number().int().min(1).max(50),
  orderNumberPrefix: z.string().regex(/^[A-Z]{1,6}$/),
  paymentMethods: z.strictObject({ cod: z.boolean(), instapay: z.boolean(), split: z.boolean() }),
  /** Shown to customers only when configured by the owner (null = staff send details on WhatsApp). */
  instapay: instapaySettingsSchema.nullable(),
});

// ── order review (private, staff-only fraud/manual-review rules) ─
const toggle = z.strictObject({ enabled: z.boolean() });
export const orderReviewSettingsSchema = z.strictObject({
  /** 'default' = the conservative starter rules shipped with the platform; 'custom' once edited. */
  preset: z.enum(['default', 'custom']),
  highValue: toggle.extend({ threshold: z.number().min(0) }),
  multipleExpensive: toggle.extend({
    unitPrice: z.number().min(0),
    minUnits: z.number().int().min(1),
  }),
  newCustomer: toggle.extend({ minTotal: z.number().min(0) }),
  splitPayment: toggle,
  unfinishedOrders: toggle.extend({
    maxCount: z.number().int().min(1),
    windowDays: z.number().int().min(1).max(365),
  }),
  velocity: toggle.extend({
    maxOrders: z.number().int().min(1),
    windowHours: z.number().int().min(1).max(720),
  }),
});

// ── SEO defaults ─────────────────────────────────────────
export const seoSettingsSchema = z.strictObject({
  titleTemplate: localizedTextSchema.refine(
    (v) => v.ar.includes('%s') && (v.en === undefined || v.en.includes('%s')),
    'Title template must contain %s',
  ),
  defaultTitle: localizedTextSchema,
  defaultDescription: localizedTextSchema,
  allowIndexing: z.boolean(),
});

// ── security (private, staff-only) ───────────────────────
export const securitySettingsSchema = z.strictObject({
  /** When true, sensitive admin RPCs require an authenticator-app (TOTP, aal2) session. */
  adminMfaRequired: z.boolean(),
});

export type BrandSettings = z.infer<typeof brandSettingsSchema>;
export type ThemeSettings = z.infer<typeof themeSettingsSchema>;
export type NavItem = z.infer<typeof navItemSchema>;
export type NavigationSettings = z.infer<typeof navigationSettingsSchema>;
export type OpeningHoursRuleSetting = z.infer<typeof openingHoursRuleSchema>;
export type Branch = z.infer<typeof branchSchema>;
export type StoreSettings = z.infer<typeof storeSettingsSchema>;
export type SocialSettings = z.infer<typeof socialSettingsSchema>;
export type LocalizationSettings = z.infer<typeof localizationSettingsSchema>;
export type FeaturesSettings = z.infer<typeof featuresSettingsSchema>;
export type SeoSettings = z.infer<typeof seoSettingsSchema>;
export type SecuritySettings = z.infer<typeof securitySettingsSchema>;
export type TrustItem = z.infer<typeof trustItemSchema>;
export type TrustSettings = z.infer<typeof trustSettingsSchema>;
export type CatalogSettings = z.infer<typeof catalogSettingsSchema>;
export type InstapaySettings = z.infer<typeof instapaySettingsSchema>;
export type CommerceSettings = z.infer<typeof commerceSettingsSchema>;
export type OrderReviewSettings = z.infer<typeof orderReviewSettingsSchema>;
