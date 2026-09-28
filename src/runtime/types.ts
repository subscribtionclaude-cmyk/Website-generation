import type { QueryClient } from '@tanstack/react-query';
import type { AppConfig, DataMode } from '@/config/env';
import type { Repositories } from '@/repositories/types';
import type { AuthService } from '@/services/auth/types';

/** Everything the UI needs from the outside world, created once at boot for the active data mode. */
export interface AppRuntime {
  config: AppConfig;
  mode: DataMode;
  auth: AuthService;
  repositories: Repositories;
  /**
   * Site Editor preview only: receives the query cache so editor drafts pushed from the admin can
   * refresh the rendered storefront (see src/preview/previewRuntime.ts).
   */
  attachQueryClient?: (client: QueryClient) => void;
}
