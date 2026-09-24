import { describe, expect, it } from 'vitest';
import { looksLikeSecretKey, resolveAppConfig } from './env';

const jwt = (payload: object) =>
  `header.${btoa(JSON.stringify(payload)).replace(/=+$/, '')}.signature`;
const URL_ = 'https://abcd.supabase.co';
const ANON = jwt({ role: 'anon', iss: 'supabase' });

describe('resolveAppConfig', () => {
  it('defaults to demo mode when Supabase is not configured', () => {
    const result = resolveAppConfig({});
    expect(result).toEqual({
      ok: true,
      config: { dataMode: 'demo', dataModeSource: 'auto', supabase: null, siteUrl: null },
    });
  });

  it('defaults to live mode when Supabase is configured', () => {
    const result = resolveAppConfig({
      VITE_SUPABASE_URL: `${URL_}/`,
      VITE_SUPABASE_ANON_KEY: ANON,
    });
    expect(result.ok && result.config).toMatchObject({
      dataMode: 'live',
      supabase: { url: URL_, anonKey: ANON },
    });
  });

  it('honours an explicit demo mode even when Supabase is configured', () => {
    const result = resolveAppConfig({
      VITE_DATA_MODE: 'demo',
      VITE_SUPABASE_URL: URL_,
      VITE_SUPABASE_ANON_KEY: ANON,
    });
    expect(result.ok && result.config.dataMode).toBe('demo');
  });

  it('never falls back to demo silently: live mode without Supabase is an error', () => {
    const result = resolveAppConfig({ VITE_DATA_MODE: 'live' });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues.map((i) => i.code)).toEqual(['live_mode_requires_supabase']);
  });

  it('rejects a service-role key in the frontend', () => {
    const result = resolveAppConfig({
      VITE_SUPABASE_URL: URL_,
      VITE_SUPABASE_ANON_KEY: jwt({ role: 'service_role' }),
    });
    expect(!result.ok && result.issues.map((i) => i.code)).toContain('secret_key_in_frontend');
    expect(
      resolveAppConfig({ VITE_SUPABASE_URL: URL_, VITE_SUPABASE_ANON_KEY: 'sb_secret_abc' }).ok,
    ).toBe(false);
  });

  it('accepts the newer publishable key format', () => {
    const result = resolveAppConfig({
      VITE_SUPABASE_URL: URL_,
      VITE_SUPABASE_ANON_KEY: 'sb_publishable_abc123',
    });
    expect(result.ok).toBe(true);
  });

  it('rejects half-configured Supabase, bad URLs and unknown modes', () => {
    expect(!resolveAppConfig({ VITE_SUPABASE_URL: URL_ }).ok).toBe(true);
    expect(
      !resolveAppConfig({ VITE_SUPABASE_URL: 'http://example.com', VITE_SUPABASE_ANON_KEY: ANON })
        .ok,
    ).toBe(true);
    expect(
      resolveAppConfig({
        VITE_SUPABASE_URL: 'http://localhost:54321',
        VITE_SUPABASE_ANON_KEY: ANON,
      }).ok,
    ).toBe(true);
    const bad = resolveAppConfig({ VITE_DATA_MODE: 'staging' });
    expect(!bad.ok && bad.issues[0]?.code).toBe('invalid_data_mode');
  });
});

describe('looksLikeSecretKey', () => {
  it('detects service-role JWTs and secret keys only', () => {
    expect(looksLikeSecretKey(jwt({ role: 'service_role' }))).toBe(true);
    expect(looksLikeSecretKey('sb_secret_x')).toBe(true);
    expect(looksLikeSecretKey(ANON)).toBe(false);
    expect(looksLikeSecretKey('sb_publishable_x')).toBe(false);
    expect(looksLikeSecretKey('not-a-jwt')).toBe(false);
  });
});
