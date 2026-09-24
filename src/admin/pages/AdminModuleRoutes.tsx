import { ADMIN_MODULES } from '../modules';
import { RequireModule } from '../RequireModule';
import { AdminRolesPage } from './AdminRolesPage';
import { AdminStoreSettingsPage } from './AdminStoreSettingsPage';

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
