import type { RouteObject } from 'react-router';
import { PageErrorBoundary } from '@/app/errors/ErrorBoundaries';
import type { Locale } from '@/i18n/config';
import { StorefrontLayout } from './layout/StorefrontLayout';
import { NotFoundPage } from './pages/NotFoundPage';
import type { SectionHandle } from './routeHandles';

/**
 * Public storefront sections scheduled for later phases. Routes exist now so navigation, links and
 * SEO structure are stable; each renders an honest placeholder until its phase ships.
 */
const PLANNED_SECTIONS: ({ path: string } & SectionHandle)[] = [
  { path: 'apple', section: 'apple', phase: 2 },
  { path: 'store', section: 'store', phase: 2 },
  { path: 'offers', section: 'offers', phase: 2 },
  { path: 'new', section: 'new', phase: 2 },
  { path: 'news', section: 'news', phase: 2 },
  { path: 'contact', section: 'contact', phase: 2 },
  { path: 'cart', section: 'cart', phase: 3 },
  { path: 'trade-in', section: 'trade-in', phase: 5 },
  { path: 'repairs', section: 'repairs', phase: 5 },
  { path: 'used', section: 'used', phase: 5 },
];

const placeholder = () =>
  import('./pages/SectionPlaceholderPage').then((m) => ({ Component: m.SectionPlaceholderPage }));

/** Storefront tree for one locale: Arabic at "/", English at "/en". */
export function storefrontRoutes(locale: Locale): RouteObject {
  return {
    path: locale === 'ar' ? '/' : '/en',
    element: <StorefrontLayout locale={locale} />,
    children: [
      {
        errorElement: <PageErrorBoundary />,
        children: [
          {
            index: true,
            lazy: () => import('./pages/HomePage').then((m) => ({ Component: m.HomePage })),
          },
          ...PLANNED_SECTIONS.map(({ path, section, phase }) => ({
            path,
            handle: { section, phase } satisfies SectionHandle,
            lazy: placeholder,
          })),
          {
            path: 'account',
            lazy: () => import('./pages/AccountPage').then((m) => ({ Component: m.AccountPage })),
          },
          {
            path: 'account/sign-in',
            lazy: () => import('./pages/SignInPage').then((m) => ({ Component: m.SignInPage })),
          },
          // Static: the error boundary already bundles the 404 page.
          { path: '*', Component: NotFoundPage },
        ],
      },
    ],
  };
}
