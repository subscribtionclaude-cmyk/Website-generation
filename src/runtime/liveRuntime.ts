import type { AppConfig } from '@/config/env';
import { createSupabaseRepositories } from '@/repositories/supabase/supabaseRepositories';
import { SupabaseAuthService } from '@/services/auth/supabaseAuthService';
import { createSupabaseBrowserClient } from '@/services/supabase/client';
import type { AppRuntime } from './types';

export function createLiveRuntime(config: AppConfig): AppRuntime {
  if (config.dataMode !== 'live' || !config.supabase) {
    throw new Error('Live runtime requires live mode with Supabase configuration');
  }
  const client = createSupabaseBrowserClient(config.supabase);
  return {
    config,
    mode: 'live',
    auth: new SupabaseAuthService(client),
    repositories: createSupabaseRepositories(client),
  };
}
