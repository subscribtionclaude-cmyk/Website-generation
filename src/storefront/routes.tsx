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
  { path: 'trade-in', section: 'trade-in', phase: 5 },
  { path: 'repairs', section: 'repairs', phase: 5 },
  { path: 'used', section: 'used', phase: 5 },
];

const storePages = () => import('./pages/StorePage');
const offersPages = () => import('./pages/OffersPages');
const newsPages = () => import('./pages/NewsPages');
const newPages = () => import('./pages/NewPages');
const orderPages = () => import('./pages/OrderPage');

/** Phase 02 storefront pages (each a lazy chunk; the admin bundle is never pulled in). */
const STOREFRONT_PAGES: RouteObject[] = [
  {
    path: 'apple',
    lazy: () => import('./pages/ApplePage').then((m) => ({ Component: m.ApplePage })),
  },
  { path: 'store', lazy: () => storePages().then((m) => ({ Component: m.StorePage })) },
  { path: 'search', lazy: () => storePages().then((m) => ({ Component: m.SearchPage })) },
  { path: 'budget', lazy: () => storePages().then((m) => ({ Component: m.BudgetPage })) },
  { path: 'category/:slug', lazy: () => storePages().then((m) => ({ Component: m.CategoryPage })) },
  { path: 'brand/:slug', lazy: () => storePages().then((m) => ({ Component: m.BrandPage })) },
  {
    path: 'product/:slug',
    lazy: () => import('./pages/ProductPage').then((m) => ({ Component: m.ProductPage })),
  },
  { path: 'offers', lazy: () => offersPages().then((m) => ({ Component: m.OffersPage })) },
  {
    path: 'offers/:slug',
    lazy: () => offersPages().then((m) => ({ Component: m.OfferDetailPage })),
  },
  { path: 'new', lazy: () => newPages().then((m) => ({ Component: m.NewPage })) },
  { path: 'coming-soon', lazy: () => newPages().then((m) => ({ Component: m.ComingSoonPage })) },
  { path: 'news', lazy: () => newsPages().then((m) => ({ Component: m.NewsPage })) },
  { path: 'news/:slug', lazy: () => newsPages().then((m) => ({ Component: m.EntryPage })) },
  {
    path: 'contact',
    lazy: () => import('./pages/ContactPage').then((m) => ({ Component: m.ContactPage })),
  },
];

/** Phase 03 commerce pages. Auth is only required from checkout onwards. */
const COMMERCE_PAGES: RouteObject[] = [
  { path: 'cart', lazy: () => import('./pages/CartPage').then((m) => ({ Component: m.CartPage })) },
  {
    path: 'checkout',
    lazy: () => import('./pages/CheckoutPage').then((m) => ({ Component: m.CheckoutPage })),
  },
  {
    path: 'order/:orderNumber',
    lazy: () => orderPages().then((m) => ({ Component: m.OrderPage })),
  },
  {
    path: 'order/:orderNumber/invoice',
    lazy: () => import('./pages/InvoicePage').then((m) => ({ Component: m.InvoicePage })),
  },
];

const accountPages = () => import('./pages/account/AccountPages');

/** Phase 04 customer pages. Wishlist and compare also work signed out (kept in this browser). */
const CUSTOMER_PAGES: RouteObject[] = [
  {
    path: 'account',
    lazy: () => accountPages().then((m) => ({ Component: m.AccountLayout })),
    children: [
      { index: true, lazy: () => accountPages().then((m) => ({ Component: m.AccountOverview })) },
      { path: 'orders', lazy: () => accountPages().then((m) => ({ Component: m.AccountOrders })) },
      {
        path: 'requests',
        lazy: () => accountPages().then((m) => ({ Component: m.AccountRequests })),
      },
      {
        path: 'notifications',
        lazy: () => accountPages().then((m) => ({ Component: m.AccountNotifications })),
      },
      {
        path: 'reviews',
        lazy: () => accountPages().then((m) => ({ Component: m.AccountReviews })),
      },
      {
        path: 'addresses',
        lazy: () => accountPages().then((m) => ({ Component: m.AccountAddresses })),
      },
      {
        path: 'profile',
        lazy: () => accountPages().then((m) => ({ Component: m.AccountProfile })),
      },
    ],
  },
  {
    path: 'wishlist',
    lazy: () => import('./pages/WishlistPage').then((m) => ({ Component: m.WishlistPage })),
  },
  {
    path: 'compare',
    lazy: () => import('./pages/ComparePage').then((m) => ({ Component: m.ComparePage })),
  },
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
          ...STOREFRONT_PAGES,
          ...COMMERCE_PAGES,
          ...PLANNED_SECTIONS.map(({ path, section, phase }) => ({
            path,
            handle: { section, phase } satisfies SectionHandle,
            lazy: placeholder,
          })),
          ...CUSTOMER_PAGES,
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
