import { describe, expect, it, vi } from 'vitest';

// "(Deleted user)" marker written by migration 11 is shown localized; other names are untouched.
async function load(lang: 'en' | 'ar') {
  vi.resetModules();
  (globalThis as unknown as { window: unknown }).window = {};
  (globalThis as unknown as { localStorage: unknown }).localStorage = { getItem: () => lang, setItem: () => {} };
  return import('../../src/lib/i18n');
}

describe('personName', () => {
  it('keeps normal names and empty values', async () => {
    const { personName } = await load('en');
    expect(personName('Mostafa Adel')).toBe('Mostafa Adel');
    expect(personName(null)).toBe('');
    expect(personName('')).toBe('');
  });
  it('shows the deleted marker in English', async () => {
    const { personName } = await load('en');
    expect(personName('Mostafa Adel (Deleted user)')).toBe('Mostafa Adel (Deleted user)');
  });
  it('translates the deleted marker in Arabic but keeps the stored name', async () => {
    const { personName } = await load('ar');
    expect(personName('Mostafa Adel (Deleted user)')).toBe('Mostafa Adel (مستخدم محذوف)');
    expect(personName('Deleted user fan')).toBe('Deleted user fan');
  });
});
