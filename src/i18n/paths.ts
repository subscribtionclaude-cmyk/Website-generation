import { DEFAULT_LOCALE, type Locale } from './config';

/**
 * URL strategy: Arabic (default) lives at the root (`/store`), English under a prefix (`/en/store`).
 * Admin routes (`/admin/...`) are not locale-prefixed: the dashboard language is a per-user preference.
 */
const LOCALE_PREFIX: Record<Locale, string> = { ar: '', en: '/en' };

export function isExternalHref(href: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href);
}

/** Split a pathname into its locale and the locale-less path. */
export function parseLocalePath(pathname: string): { locale: Locale; path: string } {
  if (pathname === '/en' || pathname.startsWith('/en/')) {
    const rest = pathname.slice(3);
    return { locale: 'en', path: rest === '' ? '/' : rest };
  }
  return { locale: DEFAULT_LOCALE, path: pathname || '/' };
}

/** Prefix an internal, locale-less path with the locale segment. External URLs pass through. */
export function localizePath(path: string, locale: Locale): string {
  if (isExternalHref(path) || path.startsWith('#')) return path;
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const prefix = LOCALE_PREFIX[locale];
  if (!prefix) return normalized;
  return normalized === '/' ? prefix : `${prefix}${normalized}`;
}

/** Same page, other language — preserves the query string and hash. */
export function switchLocalePath(
  location: { pathname: string; search?: string; hash?: string },
  target: Locale,
): string {
  const { path } = parseLocalePath(location.pathname);
  return `${localizePath(path, target)}${location.search ?? ''}${location.hash ?? ''}`;
}
