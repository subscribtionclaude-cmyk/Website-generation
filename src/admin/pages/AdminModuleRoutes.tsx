import { ADMIN_MODULES } from '../modules';
import { RequireModule } from '../RequireModule';
import { AdminRolesPage } from './AdminRolesPage';
import { AdminAbandonedCartsPage } from './customers/AdminAbandonedCartsPage';
import { AdminReviewsPage } from './customers/AdminReviewsPage';
import { AdminStoreSettingsPage } from './AdminStoreSettingsPage';
import { AdminOrderDetailPage } from './orders/AdminOrderDetailPage';
import { AdminOrdersPage } from './orders/AdminOrdersPage';

function moduleById(id: string) {
  const module = ADMIN_MODULES.find((m) => m.id === id);
  if (!module) throw new Error(`Unknown admin module: ${id}`);
  return module;
}

export function StoreSettingsRoute() {
  return (
    <RequireModule module={moduleById('store-settings')}>
      <AdminStoreSettingsPage />
    </RequireModule>
  );
}

export function RolesRoute() {
  return (
    <RequireModule module={moduleById('roles')}>
      <AdminRolesPage />
    </RequireModule>
  );
}

export function OrdersRoute() {
  return (
    <RequireModule module={moduleById('orders')}>
      <AdminOrdersPage />
    </RequireModule>
  );
}

export function OrderDetailRoute() {
  return (
    <RequireModule module={moduleById('orders')}>
      <AdminOrderDetailPage />
    </RequireModule>
  );
}

export function ReviewsRoute() {
  return (
    <RequireModule module={moduleById('reviews')}>
      <AdminReviewsPage />
    </RequireModule>
  );
}

export function AbandonedCartsRoute() {
  return (
    <RequireModule module={moduleById('abandoned-carts')}>
      <AdminAbandonedCartsPage />
    </RequireModule>
  );
}
