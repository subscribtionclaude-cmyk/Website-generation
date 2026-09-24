import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { SupabaseConfig } from '@/config/env';

/**
 * The single Supabase client for the browser. Uses only the PUBLIC anon/publishable key;
 * every read/write is authorised by Row Level Security and security-definer RPCs in the database.
 * PKCE flow: magic-link redirects exchange a one-time code instead of exposing tokens in the URL.
 */
export function createSupabaseBrowserClient(config: SupabaseConfig): SupabaseClient {
  return createClient(config.url, config.anonKey, {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'malek-store-auth',
    },
    global: {
      headers: { 'x-client-info': 'malek-store-web' },
    },
  });
}
