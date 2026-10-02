import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end smoke tests against the production build (`vite preview`) in demo mode.
 * Uses a preinstalled Chromium when PLAYWRIGHT_CHROMIUM_PATH is set (CI images / sandboxes),
 * otherwise Playwright's own browser (`npx playwright install chromium`).
 */
const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
// Lets e2e/pwa offline tests route (abort) the service worker's own network requests; specs that
// don't opt in to service workers are unaffected.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS ??= '1';
const launchOptions =
  chromiumPath && existsSync(chromiumPath) ? { executablePath: chromiumPath } : {};

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    launchOptions,
    // Specs run without the service worker (network mocks and fresh data per test); e2e/pwa.spec.ts
    // opts back in to test offline support.
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    {
      name: 'tablet',
      use: {
        browserName: 'chromium',
        viewport: { width: 820, height: 1180 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } },
    },
    {
      name: 'large-desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } },
    },
  ],
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    env: { VITE_DATA_MODE: 'demo' },
    timeout: 120_000,
  },
});
