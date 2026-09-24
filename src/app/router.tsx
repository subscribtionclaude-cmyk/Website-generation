import { createBrowserRouter, Outlet, ScrollRestoration } from 'react-router';
import { adminRoutes } from '@/admin/routes';
import { ThemeController } from '@/features/theme/ThemeController';
import { storefrontRoutes } from '@/storefront/routes';
import { RootErrorBoundary } from './errors/ErrorBoundaries';

function RootLayout() {
  return (
    <>
      <ThemeController />
      <ScrollRestoration />
      <Outlet />
    </>
  );
}

export const appRoutes = [
  {
    element: <RootLayout />,
    errorElement: <RootErrorBoundary />,
    children: [storefrontRoutes('ar'), storefrontRoutes('en'), adminRoutes],
  },
];

export function createAppRouter() {
  return createBrowserRouter(appRoutes);
}
