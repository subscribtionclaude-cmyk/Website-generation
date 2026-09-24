import type { AppConfig, DataMode } from '@/config/env';
import type { Repositories } from '@/repositories/types';
import type { AuthService } from '@/services/auth/types';

/** Everything the UI needs from the outside world, created once at boot for the active data mode. */
export interface AppRuntime {
  config: AppConfig;
  mode: DataMode;
  auth: AuthService;
  repositories: Repositories;
}
