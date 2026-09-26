import type { RouteObject } from 'react-router';
import { PageErrorBoundary } from '@/app/errors/ErrorBoundaries';

/**
 * Admin route tree. Everything under /admin is lazy-loaded as separate chunks, so storefront
 * visitors never download admin code. Module-level permission checks happen in each page
 * (RequireModule) and, authoritatively, in the database.
 */
export const adminRoutes: RouteObject = {
  path: '/admin',
  lazy: () => import('./AdminRoot').then((m) => ({ Component: m.AdminRoot })),
  children: [
    {
      path: 'sign-in',
      lazy: () => import('./pages/AdminSignInPage').then((m) => ({ Component: m.AdminSignInPage })),
    },
    {
      lazy: () => import('./AdminShell').then((m) => ({ Component: m.AdminShell })),
      children: [
        {
          errorElement: <PageErrorBoundary />,
          children: [
            {
              index: true,
              lazy: () =>
                import('./pages/AdminDashboardPage').then((m) => ({
                  Component: m.AdminDashboardPage,
                })),
            },
            {
              path: 'settings/store',
              lazy: () =>
                import('./pages/AdminModuleRoutes').then((m) => ({
                  Component: m.StoreSettingsRoute,
                })),
            },
            {
              path: 'access/roles',
              lazy: () =>
                import('./pages/AdminModuleRoutes').then((m) => ({ Component: m.RolesRoute })),
            },
            {
              path: 'orders',
              lazy: () =>
                import('./pages/AdminModuleRoutes').then((m) => ({ Component: m.OrdersRoute })),
            },
            {
              path: 'orders/:orderId',
              lazy: () =>
                import('./pages/AdminModuleRoutes').then((m) => ({
                  Component: m.OrderDetailRoute,
                })),
            },
            {
              path: 'reviews',
              lazy: () =>
                import('./pages/AdminModuleRoutes').then((m) => ({ Component: m.ReviewsRoute })),
            },
            {
              path: 'abandoned-carts',
              lazy: () =>
                import('./pages/AdminModuleRoutes').then((m) => ({
                  Component: m.AbandonedCartsRoute,
                })),
            },
            {
              path: 'repairs',
              lazy: () =>
                import('./pages/AdminModuleRoutes').then((m) => ({
                  Component: m.RepairListRoute,
                })),
            },
            {
              path: 'repairs/:requestId',
              lazy: () =>
                import('./pages/AdminModuleRoutes').then((m) => ({
                  Component: m.RepairDetailRoute,
                })),
            },
            {
              path: 'trade-in',
              lazy: () =>
                import('./pages/AdminModuleRoutes').then((m) => ({
                  Component: m.TradeInListRoute,
                })),
            },
            {
              path: 'trade-in/:requestId',
              lazy: () =>
                import('./pages/AdminModuleRoutes').then((m) => ({
                  Component: m.TradeInDetailRoute,
                })),
            },
            {
              path: 'used-requests',
              lazy: () =>
                import('./pages/AdminModuleRoutes').then((m) => ({
                  Component: m.UsedRequestListRoute,
                })),
            },
            {
              path: 'used-requests/:requestId',
              lazy: () =>
                import('./pages/AdminModuleRoutes').then((m) => ({
                  Component: m.UsedRequestDetailRoute,
                })),
            },
            {
              path: 'after-sales',
              lazy: () =>
                import('./pages/AdminModuleRoutes').then((m) => ({
                  Component: m.AfterSalesListRoute,
                })),
            },
            {
              path: 'after-sales/:requestId',
              lazy: () =>
                import('./pages/AdminModuleRoutes').then((m) => ({
                  Component: m.AfterSalesDetailRoute,
                })),
            },
            {
              path: ':moduleId',
              lazy: () =>
                import('./pages/AdminPlannedModulePage').then((m) => ({
                  Component: m.AdminPlannedModulePage,
                })),
            },
            {
              path: '*',
              lazy: () =>
                import('./pages/AdminPlannedModulePage').then((m) => ({
                  Component: m.AdminNotFound,
                })),
            },
          ],
        },
      ],
    },
  ],
};
