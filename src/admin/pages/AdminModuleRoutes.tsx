import { ADMIN_MODULES } from '../modules';
import { RequireModule } from '../RequireModule';
import { AdminRolesPage } from './AdminRolesPage';
import { AdminAbandonedCartsPage } from './customers/AdminAbandonedCartsPage';
import { AdminReviewsPage } from './customers/AdminReviewsPage';
import { AdminStoreSettingsPage } from './AdminStoreSettingsPage';
import { AdminOrderDetailPage } from './orders/AdminOrderDetailPage';
import { AdminOrdersPage } from './orders/AdminOrdersPage';
import { AdminServiceDetailPage, AdminServiceListPage } from './services/AdminServicePages';

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

/** Phase 05 service queues: one list + detail screen per service module. */

export function RepairListRoute() {
  return (
    <RequireModule module={moduleById('repairs')}>
      <AdminServiceListPage kind="repair" />
    </RequireModule>
  );
}

export function RepairDetailRoute() {
  return (
    <RequireModule module={moduleById('repairs')}>
      <AdminServiceDetailPage kind="repair" />
    </RequireModule>
  );
}

export function TradeInListRoute() {
  return (
    <RequireModule module={moduleById('trade-in')}>
      <AdminServiceListPage kind="trade_in" />
    </RequireModule>
  );
}

export function TradeInDetailRoute() {
  return (
    <RequireModule module={moduleById('trade-in')}>
      <AdminServiceDetailPage kind="trade_in" />
    </RequireModule>
  );
}

export function UsedRequestListRoute() {
  return (
    <RequireModule module={moduleById('used-requests')}>
      <AdminServiceListPage kind="used" />
    </RequireModule>
  );
}

export function UsedRequestDetailRoute() {
  return (
    <RequireModule module={moduleById('used-requests')}>
      <AdminServiceDetailPage kind="used" />
    </RequireModule>
  );
}

export function AfterSalesListRoute() {
  return (
    <RequireModule module={moduleById('after-sales')}>
      <AdminServiceListPage kind="after_sales" />
    </RequireModule>
  );
}

export function AfterSalesDetailRoute() {
  return (
    <RequireModule module={moduleById('after-sales')}>
      <AdminServiceDetailPage kind="after_sales" />
    </RequireModule>
  );
}
