import { describe, expect, it } from 'vitest';
import { BASE_SETTINGS } from '@/domain/settings/defaults';
import { seoChecks, type SeoOverview } from '@/domain/seo/overview';
import {
  canFinish,
  demoChoicesFor,
  setupChecklist,
  setupNeeded,
  stepIssues,
  type SetupDraft,
} from './wizard';

const base = (): SetupDraft => ({
  brand: structuredClone(BASE_SETTINGS.brand),
  store: structuredClone(BASE_SETTINGS.store),
  theme: structuredClone(BASE_SETTINGS.theme),
  demoChoice: null,
});
const ids = (d: SetupDraft, mode: 'demo' | 'live' = 'demo', demoRows = 0) =>
  Object.fromEntries(setupChecklist(d, { mode, demoRows }).map((i) => [i.id, i.done]));

describe('first-run setup wizard', () => {
  it('the shipped store details satisfy every required item except the demo decision', () => {
    const draft = base();
    const items = setupChecklist(draft, { mode: 'demo', demoRows: 50 });
    expect(items.filter((i) => i.required && !i.done).map((i) => i.id)).toEqual(['demoChoice']);
    expect(canFinish(items)).toBe(false);
    expect(
      canFinish(setupChecklist({ ...draft, demoChoice: 'keep' }, { mode: 'demo', demoRows: 50 })),
    ).toBe(true);
  });

  it('missing name, phones, address or hours block finishing', () => {
    const draft = { ...base(), demoChoice: 'keep' as const };
    draft.brand.name = ' ';
    const branch = draft.store.branches[0];
    if (!branch) throw new Error('no branch');
    branch.phones = [];
    branch.address = { ar: '', en: '' };
    branch.openingHours = [];
    const done = ids(draft);
    expect(done.storeName).toBe(false);
    expect(done.phones).toBe(false);
    expect(done.address).toBe(false);
    expect(done.hours).toBe(false);
    expect(canFinish(setupChecklist(draft, { mode: 'demo', demoRows: 0 }))).toBe(false);
  });

  it('recommendations never block: WhatsApp, e-mail, maps, English, palette', () => {
    const draft = { ...base(), demoChoice: 'keep' as const };
    draft.store.whatsappNumber = null;
    draft.store.email = null;
    const items = setupChecklist(draft, { mode: 'demo', demoRows: 0 });
    expect(items.find((i) => i.id === 'whatsapp')).toMatchObject({ required: false, done: false });
    expect(items.find((i) => i.id === 'email')).toMatchObject({ required: false, done: false });
    expect(canFinish(items)).toBe(true);
  });

  it('a live store that keeps demo rows gets a (non-blocking) warning', () => {
    const keep = { ...base(), demoChoice: 'keep' as const };
    expect(ids(keep, 'live', 12).demoInLive).toBe(false);
    expect(ids(keep, 'live', 0).demoInLive).toBe(true);
    expect(ids(keep, 'demo', 12).demoInLive).toBe(true);
    expect(ids({ ...keep, demoChoice: 'delete' }, 'live', 12).demoInLive).toBe(true);
  });

  it('only demo.manage may choose to replace or delete demo rows', () => {
    expect(demoChoicesFor(true)).toEqual(['keep', 'replace', 'delete']);
    expect(demoChoicesFor(false)).toEqual(['keep']);
  });

  it('setup is needed until completedAt is recorded', () => {
    expect(setupNeeded({ completedAt: null, completedBy: null, demoChoice: null })).toBe(true);
    expect(setupNeeded(null)).toBe(true);
    expect(
      setupNeeded({ completedAt: '2026-10-01T10:00:00Z', completedBy: 'u', demoChoice: 'keep' }),
    ).toBe(false);
  });

  it('steps validate with the storefront schemas', () => {
    const draft = base();
    expect(stepIssues('store', draft)).toEqual({});
    draft.brand.logo.src = 'javascript:alert(1)';
    expect(Object.keys(stepIssues('store', draft))).toEqual(['brand']);
    expect(stepIssues('demo', draft)).toEqual({});
  });
});

describe('SEO overview checks', () => {
  const overview: SeoOverview = {
    allowIndexing: true,
    pageSeo: null,
    products: { published: 10, missingTitle: 10, missingDescription: 2, missingImage: 0 },
    entries: { published: 0, missingTitle: 0, missingDescription: 0 },
    offers: { published: 3, missingDescription: 0 },
    categories: { visible: 5, missingDescription: 5 },
    brands: { visible: 0, missingDescription: 0 },
    demoPublished: { products: 0, offers: 0, entries: 0 },
    demoCatalogShown: false,
    missing: [],
  };

  it('demo deployments are flagged as never indexed', () => {
    const checks = seoChecks(overview, { mode: 'demo', siteUrl: null });
    expect(checks.some((c) => c.id === 'demoDeployment')).toBe(true);
    expect(checks.some((c) => c.id === 'siteUrl')).toBe(false);
  });

  it('live: missing site URL is an error and sorts first; empty content kinds are skipped', () => {
    const checks = seoChecks(overview, { mode: 'live', siteUrl: null });
    expect(checks[0]).toEqual({ id: 'siteUrl', level: 'error' });
    expect(checks.find((c) => c.id === 'productDescriptions')).toMatchObject({
      level: 'warning',
      count: 2,
    });
    expect(checks.find((c) => c.id === 'productImages')?.level).toBe('ok');
    expect(checks.some((c) => c.id === 'entryDescriptions')).toBe(false);
    expect(checks.some((c) => c.id === 'brandDescriptions')).toBe(false);
  });

  it('live: indexing off and demo rows shown on the live store are warnings', () => {
    const checks = seoChecks(
      { ...overview, allowIndexing: false, demoCatalogShown: true },
      { mode: 'live', siteUrl: 'https://malek.test' },
    );
    expect(checks.find((c) => c.id === 'siteUrl')?.level).toBe('ok');
    expect(checks.find((c) => c.id === 'indexing')?.level).toBe('warning');
    expect(checks.find((c) => c.id === 'demoShownLive')?.level).toBe('warning');
  });
});
