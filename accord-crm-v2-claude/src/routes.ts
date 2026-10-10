// Single list of every static route. scripts/postbuild.mjs reads this to emit <route>/index.html for each one,
// so refresh / bookmark / Home Screen launch work on a plain static host with NO rewrite rules.
export const STATIC_ROUTES = [
  '/dashboard/', '/leads/', '/leads/view/', '/calls/', '/pipeline/', '/follow-ups/', '/meetings/', '/proposals/', '/settings/',
  '/login/', '/set-password/',
  '/admin/', '/admin/users/', '/admin/targets/',
  '/admin/reports/daily/', '/admin/reports/weekly/', '/admin/reports/monthly/', '/admin/reports/board/', '/admin/reports/custom/',
  '/admin/analytics/calls/', '/admin/analytics/meetings/', '/admin/analytics/commercial/', '/admin/analytics/pipeline/',
  '/admin/sync/', '/admin/audit/', '/admin/config/', '/admin/status/', '/admin/export/',
];
