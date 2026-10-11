// Display metadata for the permission catalog (the catalog itself — sections, per-role modes, dependencies — lives in
// the database table permission_catalog and is the single source of truth for enforcement).
export const SECTION_ORDER = ['dashboard', 'people', 'reporting', 'data', 'export', 'admin'] as const;
export const SECTION_LABEL: Record<string, string> = {
  dashboard: 'Dashboard', people: 'People / performance', reporting: 'Reporting', data: 'Operational data', export: 'Export', admin: 'Administration',
};
export const PERM_INFO: Record<string, { label: string; desc: string }> = {
  'mgmt.dashboard': { label: 'Management dashboard', desc: 'Open the management dashboard page.' },
  'mgmt.department': { label: 'Department totals, trends and target', desc: 'Aggregated figures for the whole sales department.' },
  'perf.individual': { label: 'Individual employee performance', desc: 'Per-person aggregate KPIs (calls, response rate, meetings, proposals). Never includes notes or contact details.' },
  'perf.names': { label: 'Employee names', desc: 'Show names in performance views; otherwise people appear as “Sales member 1, 2…”.' },
  'perf.targets': { label: 'Individual targets', desc: 'Per-person call targets, achievement and remaining.' },
  'reports.view': { label: 'Reports', desc: 'Access management reports.' },
  'reports.daily': { label: 'Daily report', desc: 'Daily management report (PDF / Excel).' },
  'reports.weekly': { label: 'Weekly report', desc: 'Weekly management report (PDF / Excel).' },
  'reports.monthly': { label: 'Monthly report', desc: 'Monthly management report (PDF / Excel).' },
  'reports.board': { label: 'Board / executive summary', desc: 'Board-level summary for the selected period.' },
  'raw.leads': { label: 'Raw leads & contacts', desc: 'Individual leads, contacts (incl. emails and phones), lead timeline and files.' },
  'raw.calls': { label: 'Raw call records', desc: 'Individual call attempts, including call notes.' },
  'raw.meetings': { label: 'Raw meeting records', desc: 'Individual meetings, including meeting minutes.' },
  'raw.followups': { label: 'Raw follow-ups', desc: 'Individual follow-up tasks and their notes.' },
  'raw.proposals': { label: 'Raw proposals & forms', desc: 'Individual proposals and commercial forms, including private notes.' },
  'export.management_summary': { label: 'Management summary export', desc: 'Excel export of the management dashboard — follows the same privacy settings.' },
  'export.datasets': { label: 'Dataset exports', desc: 'Excel export of individual datasets the user can already see.' },
  'export.full': { label: 'Full CRM export', desc: 'Complete CRM workbook. Administrators only — not grantable.' },
  'admin.users': { label: 'User management', desc: 'Create, edit, deactivate and delete users.' },
  'admin.permissions': { label: 'Roles & permissions', desc: 'Change role templates and user overrides.' },
  'admin.targets': { label: 'Targets configuration', desc: 'Set call targets.' },
  'admin.config': { label: 'CRM configuration', desc: 'Working days, outcomes, stages, terminology.' },
  'admin.sync': { label: 'Google Sheet sync', desc: 'Run and review the Google Sheet import.' },
  'admin.audit': { label: 'Audit log', desc: 'Read the audit trail.' },
  'admin.system': { label: 'System configuration & status', desc: 'System status and configuration.' },
};
export interface CatalogRow { perm: string; section: string; sort: number; sales_mode: 'on' | 'off' | 'config'; viewer_mode: 'on' | 'off' | 'config'; depends_on: string | null }
export type ConfigRole = 'bd_executive' | 'viewer';
export const modeFor = (c: CatalogRow, role: string) => (role === 'admin' ? 'on' : role === 'bd_executive' ? c.sales_mode : role === 'viewer' ? c.viewer_mode : 'off');
