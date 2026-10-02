import { isAnalyticsAllowedPath, sanitizeAnalyticsParams } from '@/domain/integrations/analytics';

/**
 * Google Analytics 4 loader. Called only after the visitor accepted analytics cookies, only on
 * public pages, and never in demo mode (demo uses no network). Ads features and Google signals
 * are off; page views carry the path without its query string; parameters are whitelisted.
 */
type Gtag = (...args: unknown[]) => void;
interface GaWindow {
  dataLayer?: unknown[];
  gtag?: Gtag;
  [key: `ga-disable-${string}`]: boolean | undefined;
}

export const CONSENT_KEY = 'malek-analytics-consent';
export type ConsentChoice = 'granted' | 'denied';

export function readConsent(): ConsentChoice | null {
  try {
    const value = window.localStorage.getItem(CONSENT_KEY);
    return value === 'granted' || value === 'denied' ? value : null;
  } catch {
    return null;
  }
}

export function writeConsent(choice: ConsentChoice) {
  try {
    window.localStorage.setItem(CONSENT_KEY, choice);
  } catch {
    // Private mode / blocked storage: the choice lasts for this page view only.
  }
}

const gaWindow = () => window as unknown as GaWindow;
let loadedId: string | null = null;

export function isGaLoaded() {
  return loadedId !== null;
}

export function loadGoogleAnalytics(measurementId: string, pathname: string) {
  if (!/^G-[A-Z0-9]{4,15}$/.test(measurementId) || !isAnalyticsAllowedPath(pathname)) return false;
  const w = gaWindow();
  w[`ga-disable-${measurementId}`] = false;
  if (loadedId === measurementId) return true;
  w.dataLayer = w.dataLayer ?? [];
  w.gtag = function gtag() {
    // gtag.js expects the Arguments object itself.
    // eslint-disable-next-line prefer-rest-params
    w.dataLayer?.push(arguments);
  };
  w.gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'granted',
  });
  w.gtag('js', new Date());
  w.gtag('config', measurementId, {
    send_page_view: false,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  document.head.appendChild(script);
  loadedId = measurementId;
  return true;
}

/** Stop reporting immediately (GA's documented opt-out flag) and drop its first-party cookies. */
export function disableGoogleAnalytics(measurementId: string) {
  gaWindow()[`ga-disable-${measurementId}`] = true;
  for (const cookie of document.cookie.split(';')) {
    const name = cookie.split('=')[0]?.trim();
    if (name && (name === '_ga' || name.startsWith('_ga_')))
      document.cookie = `${name}=; Max-Age=0; path=/`;
  }
}

export function trackPageView(pathname: string, title: string) {
  const w = gaWindow();
  if (!loadedId || !w.gtag || !isAnalyticsAllowedPath(pathname)) return;
  w.gtag(
    'event',
    'page_view',
    sanitizeAnalyticsParams({
      page_path: pathname,
      // Never the query string (search terms, filters) — path only.
      page_location: `${window.location.origin}${pathname}`,
      page_title: title,
    }),
  );
}
