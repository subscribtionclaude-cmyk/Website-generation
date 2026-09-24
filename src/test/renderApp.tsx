import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { AppProviders } from '@/app/AppProviders';
import { appRoutes } from '@/app/router';
import baseSeed from '@seed/base/site-settings.json';
import type { AppConfig } from '@/config/env';
import type { SettingRecord } from '@/domain/settings/resolve';
import { createDemoRuntime } from '@/runtime/demoRuntime';
import type { AppRuntime } from '@/runtime/types';

export const DEMO_CONFIG: AppConfig = {
  dataMode: 'demo',
  dataModeSource: 'explicit',
  supabase: null,
  siteUrl: 'https://malek.test',
};

interface RenderAppOptions {
  /** Deep-merge-free override of individual published settings keys. */
  settings?: Record<string, unknown>;
  /** Make the settings repository fail (backend unavailable). */
  settingsFail?: boolean;
  mode?: 'demo' | 'live';
  /** Replace individual repositories (e.g. a failing live catalog). */
  repositories?: Partial<AppRuntime['repositories']>;
}

export function createTestRuntime(options: RenderAppOptions = {}): AppRuntime {
  const runtime = createDemoRuntime(DEMO_CONFIG);
  const records: SettingRecord[] = Object.entries({
    ...baseSeed.settings,
    ...options.settings,
  }).map(([key, value]) => ({ key, value, version: 1, updatedAt: null }));
  return {
    ...runtime,
    // `mode: 'live'` lets tests exercise live-mode UI branches while keeping in-memory adapters.
    mode: options.mode ?? 'demo',
    repositories: {
      ...runtime.repositories,
      ...options.repositories,
      settings: {
        listPublishedSettings: async () => {
          if (options.settingsFail) throw new Error('backend down');
          return records;
        },
      },
    },
  };
}

export function renderApp(path: string, options: RenderAppOptions = {}) {
  const runtime = createTestRuntime(options);
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  const result = render(
    <AppProviders runtime={runtime}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { ...result, router, runtime };
}
