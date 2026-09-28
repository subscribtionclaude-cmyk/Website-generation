import type { ComponentType } from 'react';
import type { RouteObject } from 'react-router';
import { PageErrorBoundary } from '@/app/errors/ErrorBoundaries';

/**
 * Phase 06 module route: the page chunk loads only when the route is visited, and renders
 * behind its module permission gate (the database checks every call again).
 */
function moduleRoute(
  path: string,
  moduleId: string,
  load: () => Promise<ComponentType>,
): RouteObject {
  return {
    path,
    lazy: async () => {
      const [Page, { RequireModuleId }] = await Promise.all([load(), import('./RequireModule')]);
      return {
        Component: function GuardedModulePage() {
          return (
            <RequireModuleId id={moduleId}>
              <Page />
            </RequireModuleId>
          );
        },
      };
    },
  };
}

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
            moduleRoute('products', 'products', () =>
              import('./pages/catalog/AdminProductsPage').then((m) => m.AdminProductsPage),
            ),
            moduleRoute('products/:productId', 'products', () =>
              import('./pages/catalog/AdminProductEditorPage').then(
                (m) => m.AdminProductEditorPage,
              ),
            ),
            moduleRoute('categories', 'categories', () =>
              import('./pages/catalog/AdminCategoriesPage').then((m) => m.AdminCategoriesPage),
            ),
            moduleRoute('brands', 'brands', () =>
              import('./pages/catalog/AdminBrandsPage').then((m) => m.AdminBrandsPage),
            ),
            moduleRoute('inventory', 'inventory', () =>
              import('./pages/catalog/AdminInventoryPage').then((m) => m.AdminInventoryPage),
            ),
            moduleRoute('customers', 'customers', () =>
              import('./pages/customers/AdminCustomersPage').then((m) => m.AdminCustomersPage),
            ),
            moduleRoute('customers/:customerId', 'customers', () =>
              import('./pages/customers/AdminCustomerDetailPage').then(
                (m) => m.AdminCustomerDetailPage,
              ),
            ),
            moduleRoute('waitlists', 'waitlists', () =>
              import('./pages/customers/AdminWaitlistsPage').then((m) => m.AdminWaitlistsPage),
            ),
            moduleRoute('notifications', 'notifications', () =>
              import('./pages/customers/AdminNotificationsPage').then(
                (m) => m.AdminNotificationsPage,
              ),
            ),
            moduleRoute('offers', 'offers', () =>
              import('./pages/content/AdminOffersPage').then((m) => m.AdminOffersPage),
            ),
            moduleRoute('offers/:offerId', 'offers', () =>
              import('./pages/content/AdminOfferEditorPage').then((m) => m.AdminOfferEditorPage),
            ),
            moduleRoute('news', 'news', () =>
              import('./pages/content/AdminNewsPage').then((m) => m.AdminNewsPage),
            ),
            moduleRoute('news/:entryId', 'news', () =>
              import('./pages/content/AdminNewsEditorPage').then((m) => m.AdminNewsEditorPage),
            ),
            moduleRoute('site-editor', 'site-editor', () =>
              import('./pages/siteEditor/AdminSiteEditorPage').then((m) => m.AdminSiteEditorPage),
            ),
            moduleRoute('page-content', 'page-content', () =>
              import('./pages/content/AdminPageContentPage').then((m) => m.AdminPageContentPage),
            ),
            moduleRoute('settings', 'store-settings', () =>
              import('./pages/settings/AdminSettingsPages').then((m) => m.AdminSettingsIndexPage),
            ),
            moduleRoute('settings/:key', 'store-settings', () =>
              import('./pages/settings/AdminSettingsPages').then((m) => m.AdminSettingEditorPage),
            ),
            moduleRoute('shipping', 'shipping', () =>
              import('./pages/settings/AdminSettingsPages').then((m) => m.AdminShippingPage),
            ),
            moduleRoute('receipts', 'receipts', () =>
              import('./pages/settings/AdminSettingsPages').then((m) => m.AdminReceiptsPage),
            ),
            moduleRoute('legal', 'legal', () =>
              import('./pages/settings/AdminSettingsPages').then((m) => m.AdminLegalPage),
            ),
            moduleRoute('analytics', 'analytics', () =>
              import('./pages/data/AdminAnalyticsPage').then((m) => m.AdminAnalyticsPage),
            ),
            moduleRoute('import-export', 'import-export', () =>
              import('./pages/data/AdminImportExportPage').then((m) => m.AdminImportExportPage),
            ),
            moduleRoute('backups', 'backups', () =>
              import('./pages/data/AdminBackupDemoPages').then((m) => m.AdminBackupsPage),
            ),
            moduleRoute('demo-data', 'demo-data', () =>
              import('./pages/data/AdminBackupDemoPages').then((m) => m.AdminDemoDataPage),
            ),
            moduleRoute('access/roles', 'roles', () =>
              import('./pages/system/AdminRolesPage').then((m) => m.AdminRolesPage),
            ),
            moduleRoute('access/users', 'staff', () =>
              import('./pages/system/AdminStaffPage').then((m) => m.AdminStaffPage),
            ),
            moduleRoute('audit-log', 'audit-log', () =>
              import('./pages/system/AdminAuditLogPage').then((m) => m.AdminAuditLogPage),
            ),
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
