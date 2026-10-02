import type { z } from 'zod';
import {
  brandSettingsSchema,
  storeSettingsSchema,
  themeSettingsSchema,
  type BrandSettings,
  type SetupSettings,
  type StoreSettings,
  type ThemeSettings,
} from '@/domain/settings/schemas';

/**
 * First-run setup wizard (Admin → Setup). The wizard edits the existing `brand`, `store` and
 * `theme` settings through the normal draft → publish workflow, then records completion and the
 * demo-content choice with `admin_complete_setup` (settings.publish; demo.manage to delete demo
 * rows). Pure logic here; the page is src/admin/pages/setup/AdminSetupPage.tsx.
 */
export const SETUP_STEPS = ['store', 'branding', 'demo', 'review'] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

export const DEMO_CHOICES = ['keep', 'replace', 'delete'] as const;
export type DemoChoice = (typeof DEMO_CHOICES)[number];

export interface SetupDraft {
  brand: BrandSettings;
  store: StoreSettings;
  theme: ThemeSettings;
  demoChoice: DemoChoice | null;
}

export type ChecklistId =
  | 'storeName'
  | 'logo'
  | 'phones'
  | 'address'
  | 'hours'
  | 'english'
  | 'whatsapp'
  | 'email'
  | 'maps'
  | 'theme'
  | 'demoChoice'
  | 'demoInLive';

export interface ChecklistItem {
  id: ChecklistId;
  step: SetupStep;
  /** Required items block "Finish"; the rest are recommendations. */
  required: boolean;
  done: boolean;
}

const filled = (v: string | null | undefined) => typeof v === 'string' && v.trim().length > 0;

export function setupChecklist(
  draft: SetupDraft,
  ctx: { mode: 'demo' | 'live'; demoRows: number },
): ChecklistItem[] {
  const { brand, store, theme } = draft;
  const branches = store.branches;
  const item = (id: ChecklistId, step: SetupStep, required: boolean, done: boolean) => ({
    id,
    step,
    required,
    done,
  });
  return [
    item('storeName', 'store', true, filled(brand.name)),
    item('logo', 'store', true, filled(brand.logo.src)),
    item(
      'phones',
      'store',
      true,
      branches.length > 0 && branches.every((b) => b.phones.some(filled)),
    ),
    item(
      'address',
      'store',
      true,
      branches.length > 0 && branches.every((b) => filled(b.address.ar) && filled(b.city.ar)),
    ),
    item(
      'hours',
      'store',
      true,
      branches.length > 0 && branches.every((b) => b.openingHours.length > 0),
    ),
    item(
      'english',
      'store',
      false,
      filled(brand.tagline.en) &&
        branches.every((b) => filled(b.name.en) && filled(b.address.en) && filled(b.city.en)),
    ),
    item('whatsapp', 'store', false, filled(store.whatsappNumber)),
    item('email', 'store', false, filled(store.email)),
    item(
      'maps',
      'store',
      false,
      branches.every((b) => filled(b.mapsUrl)),
    ),
    item('theme', 'branding', false, theme.preset !== undefined),
    item('demoChoice', 'demo', true, draft.demoChoice !== null),
    // A live store that keeps demo rows: they stay labelled and are never indexed, but they
    // should be replaced before launch.
    item(
      'demoInLive',
      'demo',
      false,
      !(ctx.mode === 'live' && draft.demoChoice === 'keep' && ctx.demoRows > 0),
    ),
  ];
}

export const canFinish = (items: readonly ChecklistItem[]) =>
  items.every((i) => !i.required || i.done);

/** Demo rows can only be deleted by staff with demo.manage (the database checks again). */
export function demoChoicesFor(canManageDemo: boolean): DemoChoice[] {
  return canManageDemo ? [...DEMO_CHOICES] : ['keep'];
}

export function setupNeeded(setup: SetupSettings | null | undefined): boolean {
  return !setup?.completedAt;
}

const STEP_SCHEMAS: Partial<Record<SetupStep, [keyof SetupDraft, z.ZodType][]>> = {
  store: [
    ['brand', brandSettingsSchema],
    ['store', storeSettingsSchema],
  ],
  branding: [['theme', themeSettingsSchema]],
};

/** Schema problems for a step, keyed by setting ("brand", "store", "theme"). */
export function stepIssues(step: SetupStep, draft: SetupDraft): Record<string, z.ZodError> {
  const issues: Record<string, z.ZodError> = {};
  for (const [key, schema] of STEP_SCHEMAS[step] ?? []) {
    const parsed = schema.safeParse(draft[key]);
    if (!parsed.success) issues[key] = parsed.error;
  }
  return issues;
}
