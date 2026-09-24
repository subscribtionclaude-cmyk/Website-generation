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
  payAtStore: z.boolean(),
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
