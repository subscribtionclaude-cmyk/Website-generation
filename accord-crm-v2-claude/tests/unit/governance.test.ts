import { describe, expect, it, vi } from 'vitest';

async function load(lang: 'en' | 'ar') {
  vi.resetModules();
  (globalThis as unknown as { window: unknown }).window = {};
  (globalThis as unknown as { localStorage: unknown }).localStorage = { getItem: () => lang, setItem: () => {} };
  return { term: await import('../../src/lib/terminology'), preview: await import('../../src/lib/preview') };
}

describe('preview-as-role write guard', () => {
  it('blocks every write while a preview is active, allows reads, auth and read-only RPCs', async () => {
    const { preview: p } = await load('en');
    const U = 'https://x.supabase.co';
    expect(p.blockedInPreview(`${U}/rest/v1/leads`, { method: 'POST' })).toBe(false); // no preview → nothing blocked
    p.setPreviewRole('viewer');
    expect(p.blockedInPreview(`${U}/rest/v1/leads?select=id`, { method: 'GET' })).toBe(false);
    expect(p.blockedInPreview(`${U}/rest/v1/leads`, { method: 'POST' })).toBe(true);
    expect(p.blockedInPreview(`${U}/rest/v1/leads?id=eq.1`, { method: 'PATCH' })).toBe(true);
    expect(p.blockedInPreview(`${U}/rest/v1/leads?id=eq.1`, { method: 'DELETE' })).toBe(true);
    expect(p.blockedInPreview(`${U}/rest/v1/rpc/log_call`, { method: 'POST' })).toBe(true);
    expect(p.blockedInPreview(`${U}/rest/v1/rpc/admin_set_role_permission`, { method: 'POST' })).toBe(true);
    expect(p.blockedInPreview(`${U}/functions/v1/admin-users`, { method: 'POST' })).toBe(true);
    expect(p.blockedInPreview(`${U}/storage/v1/object/crm-files/a.pdf`, { method: 'POST' })).toBe(true);
    expect(p.blockedInPreview(`${U}/rest/v1/rpc/management_report`, { method: 'POST' })).toBe(false);
    expect(p.blockedInPreview(`${U}/auth/v1/token?grant_type=refresh_token`, { method: 'POST' })).toBe(false);
    p.setPreviewRole(null);
    expect(p.blockedInPreview(`${U}/rest/v1/leads`, { method: 'POST' })).toBe(false);
  });
});

describe('terminology', () => {
  it('uses product defaults, then custom English', async () => {
    const { term: m } = await load('en');
    expect(m.term('role_sales')).toBe('Sales');
    expect(m.term('role_viewer')).toBe('Management Viewer');
    m.setTerminology({ role_sales: { en: 'Business Development', ar: '' } });
    expect(m.term('role_sales')).toBe('Business Development');
  });
  it('Arabic: custom Arabic when set, otherwise the product Arabic (never the English custom text)', async () => {
    const { term: m } = await load('ar');
    m.setTerminology({ role_sales: { en: 'Business Development', ar: '' }, management_dashboard: { en: 'Executive Dashboard', ar: 'لوحة التنفيذيين' } });
    expect(m.term('role_sales')).toBe('المبيعات');
    expect(m.term('management_dashboard')).toBe('لوحة التنفيذيين');
  });
});
