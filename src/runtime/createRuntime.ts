import type { AppConfig } from '@/config/env';
import type { AppRuntime } from './types';

/**
 * Build the runtime for the configured data mode. Each adapter set is a separate lazy chunk:
 * demo previews never download the Supabase SDK, and live builds never load demo adapters.
 */
export async function createRuntime(config: AppConfig): Promise<AppRuntime> {
  // Site Editor preview frame (named by the admin editor): its own lazy chunk, never loaded otherwise.
  if (typeof window !== 'undefined' && window.name.startsWith('malek-preview')) {
    const { createPreviewRuntime } = await import('@/preview/previewRuntime');
    return createPreviewRuntime(
      config,
      window.name === 'malek-preview-sample' ? 'sample' : 'draft',
    );
  }
  if (config.dataMode === 'demo') {
    const { createDemoRuntime } = await import('./demoRuntime');
    return createDemoRuntime(config);
  }
  const { createLiveRuntime } = await import('./liveRuntime');
  return createLiveRuntime(config);
}
