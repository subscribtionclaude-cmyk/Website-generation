import { beforeEach, describe, expect, it } from 'vitest';
import {
  CONTRAST_PAIRS,
  THEME_PRESET_TOKENS,
  TOKEN_DEFAULTS,
} from '@/admin/pages/siteEditor/themePresets';
import type { AdminActor } from '@/domain/admin/demo/demoAdmin';
import { filterOffers } from '@/domain/content/offers';
import {
  productSourceQuery,
  resolveSections,
  SECTION_PROP_SCHEMAS,
  sectionDesignSchema,
} from '@/domain/content/sections';
import type { Offer } from '@/domain/content/types';
import { BASE_SETTINGS } from '@/domain/settings/defaults';
import {
  footerSettingsSchema,
  pageSeoSettingsSchema,
  themeSettingsSchema,
} from '@/domain/settings/schemas';
import { contrastRatio } from '@/lib/color';
import { previewStateSchema, PREVIEW_STATE } from '@/preview/protocol';
import { DemoCommerceStore, actorOf } from '@/repositories/demo/demoCommerce';
import type { DemoAuthService } from '@/services/auth/demoAuthService';
import { ADDABLE_TYPES, newSection, type SectionRefs } from './defaults';
import { commit, createHistory, HISTORY_LIMIT, redo, undo } from './history';
import {
  diffLayouts,
  duplicateSection,
  moveSection,
  moveSectionBy,
  removeSection,
  sameLayout,
  structuralProblem,
  uniqueKey,
  updateSection,
  validateLayout,
} from './layout';
import type { LayoutSection } from './schemas';

const lt = (ar: string, en = ar) => ({ ar, en });
const budget = (key: string, extra: Partial<LayoutSection> = {}): LayoutSection => ({
  key,
  type: 'budget_search',
  isVisible: true,
  props: { title: lt('ميزانيتك', 'Budget'), subtitle: null },
  ...extra,
});
const REFS: SectionRefs = {
  campaignSlugs: ['launch'],
  brandSlugs: ['apple'],
  categorySlugs: ['phones'],
  trustItemIds: ['apple-authorized-reseller'],
};

// ── Layout operations ─────────────────────────────────────────────────────────
describe('layout operations', () => {
  const list = [budget('a'), budget('b'), budget('c')];

  it('moves without mutating and clamps to the list', () => {
    expect(moveSection(list, 0, 2).map((s) => s.key)).toEqual(['b', 'c', 'a']);
    expect(moveSection(list, 2, -5).map((s) => s.key)).toEqual(['c', 'a', 'b']);
    expect(moveSectionBy(list, 'b', -1).map((s) => s.key)).toEqual(['b', 'a', 'c']);
    expect(moveSectionBy(list, 'zzz', 1)).toBe(list);
    expect(list.map((s) => s.key)).toEqual(['a', 'b', 'c']);
  });

  it('duplicates next to the source with a unique slug key and a deep copy', () => {
    const { list: next, key } = duplicateSection(list, 'a');
    expect(key).toBe('a-copy');
    expect(next.map((s) => s.key)).toEqual(['a', 'a-copy', 'b', 'c']);
    expect(next[1]?.props).not.toBe(list[0]?.props);
    expect(uniqueKey([...next, budget('a-copy-2')], 'a-copy')).toBe('a-copy-3');
    expect(uniqueKey([], 'Hero Campaign!! 2026')).toBe('hero-campaign-2026');
    expect(uniqueKey([], '---')).toBe('section');
  });

  it('removes and updates by key', () => {
    expect(removeSection(list, 'b').map((s) => s.key)).toEqual(['a', 'c']);
    expect(updateSection(list, 'c', { isVisible: false })[2]?.isVisible).toBe(false);
  });

  it('compares layouts ignoring prop key order and default design', () => {
    const reordered = {
      ...budget('a'),
      props: { subtitle: null, title: lt('ميزانيتك', 'Budget') },
    };
    expect(sameLayout([budget('a')], [reordered])).toBe(true);
    expect(sameLayout([budget('a')], [budget('a', { design: { background: 'default' } })])).toBe(
      true,
    );
    expect(sameLayout([budget('a')], [budget('a', { design: { background: 'muted' } })])).toBe(
      false,
    );
  });

  it('diffs versions section by section', () => {
    const before = [budget('a'), budget('b'), budget('c')];
    const after = [
      budget('c'),
      budget('a', { isVisible: false }),
      budget('d'),
      { ...budget('b'), props: { title: lt('جديد'), subtitle: null } },
    ].filter((s) => s.key !== 'b');
    const rows = diffLayouts(before, after);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey.c?.changes).toContain('moved');
    expect(byKey.a?.changes).toEqual(expect.arrayContaining(['moved', 'hidden']));
    expect(byKey.d?.changes).toEqual(['added']);
    expect(byKey.b).toMatchObject({ from: 2, to: null, changes: ['removed'] });
  });
});

// ── Validation (mirror of app.validate_page_layout + per-type props) ──────────
describe('layout validation', () => {
  it('returns the same structural codes as the database', () => {
    expect(structuralProblem({})).toBe('invalid_layout');
    expect(structuralProblem(Array.from({ length: 41 }, (_, i) => budget(`s${i}`)))).toBe(
      'too_many_sections',
    );
    expect(structuralProblem([budget('Bad Key')])).toBe('invalid_key');
    expect(structuralProblem([budget('a'), budget('a')])).toBe('duplicate_key');
    expect(structuralProblem([{ ...budget('a'), type: 'script_tag' }])).toBe('unknown_type');
    expect(structuralProblem([{ ...budget('a'), isVisible: 'yes' }])).toBe('invalid_layout');
    expect(structuralProblem([{ ...budget('a'), props: [] }])).toBe('invalid_props');
    expect(structuralProblem([{ ...budget('a'), design: { css: 'body{}' } }])).toBe(
      'invalid_design',
    );
    expect(structuralProblem([{ ...budget('a'), design: { background: 'url(x)' } }])).toBe(
      'invalid_design',
    );
    expect(
      structuralProblem([budget('a', { design: { background: 'muted', spacing: 'compact' } })]),
    ).toBeNull();
  });

  it('checks every section against its registry schema', () => {
    const issues = validateLayout([
      budget('ok'),
      { ...budget('broken'), props: { title: lt('') } },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'invalid_props', key: 'broken' });
    expect(issues[0]?.issues?.length).toBeGreaterThan(0);
  });
});

// ── Undo / redo ───────────────────────────────────────────────────────────────
describe('editing history', () => {
  it('undoes, redoes and drops the redo branch on a new change', () => {
    let h = createHistory(1);
    h = commit(h, 2, null, 0);
    h = commit(h, 3, null, 10);
    h = undo(h);
    expect(h.present).toBe(2);
    h = redo(h);
    expect(h.present).toBe(3);
    h = undo(undo(h));
    expect(h.present).toBe(1);
    h = commit(h, 9, null, 20);
    expect(h.future).toEqual([]);
    expect(undo(h).present).toBe(1);
  });

  it('coalesces typing in one field into one step', () => {
    let h = createHistory('');
    h = commit(h, 'a', 'title', 0);
    h = commit(h, 'ab', 'title', 300);
    h = commit(h, 'abc', 'title', 600);
    expect(undo(h).present).toBe('');
    h = commit(h, 'abcd', 'title', 5000);
    expect(undo(h).present).toBe('abc');
  });

  it('keeps a bounded history', () => {
    let h = createHistory(0);
    for (let i = 1; i <= HISTORY_LIMIT + 20; i += 1) h = commit(h, i, null, i * 5000);
    expect(h.past).toHaveLength(HISTORY_LIMIT);
  });
});

// ── Add section defaults ──────────────────────────────────────────────────────
describe('new sections', () => {
  it('every addable type starts valid against its schema', () => {
    const types = new Set(Object.values(ADDABLE_TYPES).flat());
    for (const type of types) {
      const section = newSection(type, `new-${type.replace(/_/g, '-')}`, REFS);
      expect(section, type).not.toBeNull();
      expect(SECTION_PROP_SCHEMAS[type].safeParse(section?.props).success, type).toBe(true);
      expect(structuralProblem([section]), type).toBeNull();
    }
  });

  it('never invents references: types needing data are unavailable without it', () => {
    const none: SectionRefs = {
      campaignSlugs: [],
      brandSlugs: [],
      categorySlugs: [],
      trustItemIds: [],
    };
    expect(newSection('hero_campaign', 'x', none)).toBeNull();
    expect(newSection('brand_lines', 'x', none)).toBeNull();
    expect(newSection('trust_feature', 'x', none)).toBeNull();
    expect(newSection('offer_group', 'deals', none)?.props.anchor).toBe('deals');
  });
});

// ── Section registry additions ────────────────────────────────────────────────
describe('section registry (Phase 07)', () => {
  const banner = (url: string) => ({
    eyebrow: null,
    title: lt('بانر'),
    body: null,
    images: [{ url, alt: lt('صورة') }],
    layout: 'split',
    tone: 'light',
    cta: null,
  });

  it('media banners accept store media and https only (no script or svg data URLs)', () => {
    const schema = SECTION_PROP_SCHEMAS.media_banner;
    expect(schema.safeParse(banner('/brand/malek-store-logo.png')).success).toBe(true);
    expect(schema.safeParse(banner('https://cdn.example.com/a.webp')).success).toBe(true);
    expect(schema.safeParse(banner('data:image/webp;base64,AAAA')).success).toBe(true);
    expect(schema.safeParse(banner('javascript:alert(1)')).success).toBe(false);
    expect(schema.safeParse(banner('//evil.example/a.png')).success).toBe(false);
    expect(schema.safeParse(banner('data:image/svg+xml;base64,AAAA')).success).toBe(false);
    expect(schema.safeParse(banner('http://insecure.example/a.png')).success).toBe(false);
  });

  it('section design is a closed set of options', () => {
    expect(sectionDesignSchema.safeParse({ background: 'dark', spacing: 'relaxed' }).success).toBe(
      true,
    );
    expect(sectionDesignSchema.safeParse({ css: 'color:red' }).success).toBe(false);
    const [resolved] = resolveSections(
      [
        {
          id: 'a',
          type: 'budget_search',
          props: budget('a').props,
          design: { background: 'muted' },
        },
        { id: 'b', type: 'budget_search', props: budget('b').props, design: { css: 'x' } },
      ].map((r) => ({ ...r, pageKey: 'home', sortOrder: 0, isVisible: true })),
    );
    expect(resolved?.design).toEqual({ background: 'muted' });
  });

  it('hand-picked products and offers keep the editor order', () => {
    const source = { kind: 'manual' as const, productIds: ['p-2', 'p-1'] };
    expect(SECTION_PROP_SCHEMAS.product_rail.shape.source.safeParse(source).success).toBe(true);
    expect(productSourceQuery(source, 4)).toMatchObject({ sort: 'featured' });
    const offers = ['a', 'b', 'c'].map((slug) => ({ slug, kind: 'flash' }) as unknown as Offer);
    expect(filterOffers(offers, { slugs: ['c', 'a'] }).map((o) => o.slug)).toEqual(['c', 'a']);
  });
});

// ── Settings contracts ────────────────────────────────────────────────────────
describe('design settings (Phase 07)', () => {
  it('base settings include empty per-page SEO (nothing invented)', () => {
    expect(BASE_SETTINGS.page_seo.pages.home).toEqual({
      title: null,
      description: null,
      ogImage: null,
    });
  });

  it('theme scales are enums; free-form values are refused', () => {
    expect(
      themeSettingsSchema.safeParse({ tokens: {}, preset: 'midnight', radius: 'round' }).success,
    ).toBe(true);
    expect(themeSettingsSchema.safeParse({ tokens: {}, radius: '4px' }).success).toBe(false);
    expect(themeSettingsSchema.safeParse({ tokens: { css: 'x' } }).success).toBe(false);
  });

  it('footer links and share images accept safe URLs only', () => {
    const footer = (href: string) => ({
      links: [{ id: 'x', label: lt('رابط'), href, visible: true, highlight: false }],
      showServices: true,
      showSocial: true,
      showHours: false,
      note: null,
    });
    expect(footerSettingsSchema.safeParse(footer('/trade-in')).success).toBe(true);
    expect(footerSettingsSchema.safeParse(footer('javascript:alert(1)')).success).toBe(false);
    expect(footerSettingsSchema.safeParse(footer('//evil.example')).success).toBe(false);
    const seo = (ogImage: string | null) => ({
      pages: {
        home: { title: lt('الرئيسية'), description: null, ogImage },
        apple: { title: null, description: null, ogImage: null },
        offers: { title: null, description: null, ogImage: null },
      },
    });
    expect(pageSeoSettingsSchema.safeParse(seo('/brand/og.png')).success).toBe(true);
    expect(pageSeoSettingsSchema.safeParse(seo('data:image/png;base64,AA')).success).toBe(false);
  });

  it('theme presets keep AA contrast for text', () => {
    for (const [preset, tokens] of Object.entries(THEME_PRESET_TOKENS)) {
      const colour = (t: keyof typeof TOKEN_DEFAULTS) => tokens[t] ?? TOKEN_DEFAULTS[t];
      for (const [fg, bg, min] of CONTRAST_PAIRS)
        expect(
          contrastRatio(colour(fg), colour(bg)),
          `${preset}: ${fg}/${bg}`,
        ).toBeGreaterThanOrEqual(min);
    }
  });
});

// ── Preview protocol ──────────────────────────────────────────────────────────
describe('preview protocol', () => {
  it('accepts editor state and refuses anything else', () => {
    const ok = previewStateSchema.safeParse({
      type: PREVIEW_STATE,
      layouts: { home: [budget('a')] },
      settings: { theme: { tokens: {} } },
    });
    expect(ok.success).toBe(true);
    expect(
      previewStateSchema.safeParse({ type: PREVIEW_STATE, layouts: { about: [] }, settings: {} })
        .success,
    ).toBe(false);
    expect(
      previewStateSchema.safeParse({ type: PREVIEW_STATE, layouts: {}, settings: { security: {} } })
        .success,
    ).toBe(false);
    expect(previewStateSchema.safeParse({ type: 'other', layouts: {}, settings: {} }).success).toBe(
      false,
    );
  });
});

// ── Demo engine (parity with the site_editor_* RPCs) ─────────────────────────
function fakeAuth(role: string) {
  return {
    getSession: async () => ({
      userId: `demo-${role}`,
      email: `${role}@demo.invalid`,
      isDemo: true,
    }),
    demo: { getRoleKey: () => role, signInAsRole: async () => ({}) },
  } as unknown as DemoAuthService;
}

describe('demo site editor engine', () => {
  let store: DemoCommerceStore;
  const as = (role: string): Promise<AdminActor> => actorOf(fakeAuth(role), store);
  const live = () => store.admin.sections('home').map((s) => s.id);

  beforeEach(() => {
    localStorage.clear();
    store = new DemoCommerceStore();
  });

  it('enforces design.view / design.edit / design.publish like the database', async () => {
    const sales = await as('sales');
    expect(() => store.admin.layouts.overview(sales)).toThrow();
    const manager = await as('store_manager');
    expect(store.admin.layouts.overview(manager)).toHaveLength(3);
    expect(store.admin.layouts.getPage(manager, 'home')?.canEdit).toBe(false);
    expect(() => store.admin.layouts.saveDraft(manager, 'home', [], null)).toThrow();
    expect(() => store.admin.layouts.publish(manager, 'home', null)).toThrow();
    expect(store.admin.layouts.getPage(manager, 'about')).toBeNull();
  });

  it('drafts stay private until publish; publish versions; rollback restores', async () => {
    const designer = await as('design_editor');
    const page = store.admin.layouts.getPage(designer, 'home');
    const published = page?.published ?? [];
    const original = live();
    const reordered = moveSection(published, 1, 0);

    const saved = store.admin.layouts.saveDraft(designer, 'home', reordered, null);
    expect(saved).toMatchObject({ ok: true, baseVersion: null });
    expect(live()).toEqual(original); // the storefront never sees a draft

    const second = await as('owner');
    expect(store.admin.layouts.saveDraft(second, 'home', [], null)).toEqual({
      ok: false,
      code: 'draft_conflict',
    });

    expect(store.admin.layouts.publish(designer, 'home', 'Reorder')).toEqual({
      ok: true,
      version: 2,
    });
    expect(live()[0]).toBe(original[1]);
    expect(store.admin.layouts.versions(designer, 'home').map((v) => v.note)).toEqual([
      'Reorder',
      'Initial layout',
    ]);
    expect(store.admin.layouts.publish(designer, 'home', null)).toEqual({
      ok: false,
      code: 'no_draft',
    });

    expect(store.admin.layouts.rollback(designer, 'home', 1, null)).toEqual({
      ok: true,
      version: 3,
    });
    expect(live()).toEqual(original);
    expect(store.admin.layouts.versions(designer, 'home', 1)[0]?.note).toBe('Restored version 1');
    expect(store.admin.layouts.rollback(designer, 'home', 99, null)).toEqual({
      ok: false,
      code: 'version_not_found',
    });

    const actions = store.admin.data
      .listAuditLogs(await as('owner'), { module: 'design' })
      .items.map((r) => r.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'site_editor.draft_saved',
        'site_editor.published',
        'site_editor.rolled_back',
      ]),
    );
  });

  it('a Phase 06 live edit is a version and makes an older draft stale', async () => {
    const owner = await as('owner');
    const published = store.admin.layouts.getPage(owner, 'home')?.published ?? [];
    expect(store.admin.layouts.saveDraft(owner, 'home', published, null).ok).toBe(true);
    const hero = store.admin.content.listPageSections(owner, 'home')[0];
    if (!hero) throw new Error('missing hero');
    const edit = store.admin.content.savePageSection(
      owner,
      hero.id,
      false,
      hero.props,
      hero.updatedAt,
    );
    expect(edit.ok).toBe(true);
    expect(store.admin.layouts.currentVersion('home')).toBe(2); // initial + content edit
    expect(store.admin.layouts.publish(owner, 'home', null)).toEqual({
      ok: false,
      code: 'draft_conflict',
    });
    expect(store.admin.layouts.publish(owner, 'home', null, true)).toEqual({
      ok: true,
      version: 3,
    });
  });

  it('refuses the same invalid layouts as the database', async () => {
    const designer = await as('design_editor');
    expect(store.admin.layouts.saveDraft(designer, 'about', [], null)).toEqual({
      ok: false,
      code: 'invalid_page',
    });
    expect(
      store.admin.layouts.saveDraft(
        designer,
        'home',
        [budget('a', { design: { css: 'x' } as never })],
        null,
      ),
    ).toEqual({ ok: false, code: 'invalid_design' });
  });
});
