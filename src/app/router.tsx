import {
  createBrowserRouter,
  Outlet,
  ScrollRestoration,
  type Location,
  type PatchRoutesOnNavigationFunction,
} from 'react-router';
import { ThemeController } from '@/features/theme/ThemeController';
import { storefrontRoutes } from '@/storefront/routes';
import { RootErrorBoundary } from './errors/ErrorBoundaries';

/**
 * Every full page load starts on a history entry keyed "default", so keying saved scroll positions by
 * `location.key` alone made a freshly loaded page jump to wherever the previous page was scrolled.
 * The first entry of a document is keyed by its URL instead; later entries keep their own key.
 */
export const scrollKey = (location: Location) =>
  location.key === 'default' ? `${location.pathname}${location.search}` : location.key;

function RootLayout() {
  return (
    <>
      <ThemeController />
      <ScrollRestoration getKey={scrollKey} />
      <Outlet />
    </>
  );
}

const ROOT_ROUTE_ID = 'root';

/** Storefront routes (Arabic and /en). The admin tree is added on demand by `discoverRoutes`. */
export const appRoutes = [
  {
    id: ROOT_ROUTE_ID,
    element: <RootLayout />,
    errorElement: <RootErrorBoundary />,
    children: [storefrontRoutes('ar'), storefrontRoutes('en')],
  },
];

/**
 * The admin route table loads on the first visit to /admin, so storefront visitors never download
 * it. React Router asks here whenever a URL is not matched or only matched by a dynamic / catch-all
 * route; once the admin tree is in place it returns at once.
 */
export const discoverRoutes: PatchRoutesOnNavigationFunction = async ({ path, matches, patch }) => {
  if (path !== '/admin' && !path.startsWith('/admin/')) return;
  if (matches.some((match) => match.route.path === '/admin')) return; // already added
  const { adminRoutes } = await import('@/admin/routes');
  patch(ROOT_ROUTE_ID, [adminRoutes]);
};

export function createAppRouter() {
  return createBrowserRouter(appRoutes, { patchRoutesOnNavigation: discoverRoutes });
}
