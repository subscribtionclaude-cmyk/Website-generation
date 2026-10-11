import { useSyncExternalStore } from 'react';
import { currentLang, t } from './i18n';

// Admin-editable DISPLAY labels (English + Arabic). Presentation only: canonical role keys (admin / bd_executive /
// viewer) and business data never change. Stored in settings.terminology; a blank custom label falls back to the
// product's own wording (and its Arabic translation) — custom text is never auto-translated.
export const TERM_DEFAULTS = {
  role_admin: 'Admin',
  role_sales: 'Sales',
  role_viewer: 'Management Viewer',
  sales_team: 'Sales Team',
  sales_department: 'Sales Department',
  management_dashboard: 'Management Dashboard',
} as const;
export type TermKey = keyof typeof TERM_DEFAULTS;
export type Terminology = Partial<Record<TermKey, { en?: string; ar?: string }>>;

let custom: Terminology = {};
let version = 0;
const subs = new Set<() => void>();
export function setTerminology(v: Terminology | null | undefined) {
  custom = v && typeof v === 'object' ? v : {};
  version++; subs.forEach((f) => f());
}
export const getTerminology = (): Terminology => custom;
/** subscribe a component (App) so a terminology change re-renders every label in place */
export function useTerminologyVersion(): number {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => version, () => 0);
}

/** The display label for a terminology key in the current language. */
export function term(k: TermKey): string {
  const c = custom[k];
  const own = currentLang() === 'ar' ? c?.ar : c?.en;
  return own && own.trim() ? own.trim() : t(TERM_DEFAULTS[k]);
}
