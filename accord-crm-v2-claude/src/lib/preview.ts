import { useSyncExternalStore } from 'react';

// "Preview as role" (admin only). PURELY a UI preview: the signed-in identity, JWT and backend permissions never change.
// While a preview is active the network layer refuses every write (see supabase.ts), so nothing can be executed
// "as" the previewed role — or at all. Kept in memory only (a reload ends the preview).
export type PreviewRole = 'bd_executive' | 'viewer';
let current: PreviewRole | null = null;
const subs = new Set<() => void>();
export const previewRole = (): PreviewRole | null => current;
export function setPreviewRole(r: PreviewRole | null) { current = r; subs.forEach((f) => f()); }
export function usePreviewRole(): PreviewRole | null {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => current, () => null);
}

/** Read-only RPCs a preview may still call (they only read; management_report gets p_preview_role). */
export const PREVIEW_READ_RPCS = new Set([
  'management_report', 'my_permissions', 'role_template', 'admin_report', 'call_metrics', 'call_metrics_daily',
  'my_call_metrics', 'system_status', 'user_effective_permissions', 'admin_user_signins', 'has_perm',
]);
export const PREVIEW_BLOCKED = 'Preview mode is read-only — exit the preview to make changes.';

/** True when a request would change data and must be refused during a preview. */
export function blockedInPreview(input: RequestInfo | URL, init?: RequestInit): boolean {
  if (!current) return false;
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false;
  const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const path = new URL(href, 'http://x').pathname;
  if (path.includes('/auth/v1/')) return false; // session refresh / sign-out stay possible
  const rpc = /\/rest\/v1\/rpc\/([^/?]+)/.exec(path);
  if (rpc && PREVIEW_READ_RPCS.has(rpc[1])) return false;
  return path.includes('/rest/v1/') || path.includes('/functions/v1/') || path.includes('/storage/v1/');
}
