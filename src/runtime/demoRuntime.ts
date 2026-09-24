import type { AppConfig } from '@/config/env';
import { createDemoRepositories } from '@/repositories/demo/demoRepositories';
import { DemoAuthService } from '@/services/auth/demoAuthService';
import type { AppRuntime } from './types';

export function createDemoRuntime(config: AppConfig): AppRuntime {
  if (config.dataMode !== 'demo') throw new Error('Demo runtime requested outside demo mode');
  const auth = new DemoAuthService();
  return { config, mode: 'demo', auth, repositories: createDemoRepositories(auth) };
}
