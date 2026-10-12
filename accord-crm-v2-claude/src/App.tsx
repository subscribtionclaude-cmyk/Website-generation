import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { configured } from './lib/supabase';
import { AppShell, useHomePath } from './components/Layout';
import { usePerms } from './lib/perms';
import { Loading } from './components/ui';
import { LoginPage, SetPasswordPage, NoAccessPage, BootScreen } from './pages/AuthPages';
import { t, useI18n } from './lib/i18n';
import { useTerminologyVersion } from './lib/terminology';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Leads = lazy(() => import('./pages/Leads'));
const LeadView = lazy(() => import('./pages/LeadView'));
const Calls = lazy(() => import('./pages/Calls'));
const Pipeline = lazy(() => import('./pages/Pipeline'));
const FollowUps = lazy(() => import('./pages/FollowUps'));
const Meetings = lazy(() => import('./pages/Meetings'));
const Proposals = lazy(() => import('./pages/Proposals'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const AdminOverview = lazy(() => import('./pages/admin/Overview'));
const AdminUsers = lazy(() => import('./pages/admin/Users'));
const AdminTargets = lazy(() => import('./pages/admin/Targets'));
const AdminReports = lazy(() => import('./pages/admin/Reports'));
const AdminAnalytics = lazy(() => import('./pages/admin/Analytics'));
const AdminSync = lazy(() => import('./pages/admin/Sync'));
const AdminAudit = lazy(() => import('./pages/admin/Audit'));
const AdminConfig = lazy(() => import('./pages/admin/Config'));
const AdminStatus = lazy(() => import('./pages/admin/Status'));
const AdminExport = lazy(() => import('./pages/admin/Export'));
const Management = lazy(() => import('./pages/Management'));
const AdminRoles = lazy(() => import('./pages/admin/Roles'));
const AdminTerminology = lazy(() => import('./pages/admin/Terminology'));

// Once the app is idle, fetch the main page bundles so moving between sections never waits on a download.
const PREFETCH = [() => import('./pages/Dashboard'), () => import('./pages/Management'), () => import('./pages/Leads'), () => import('./pages/Calls'), () => import('./pages/Pipeline'),
  () => import('./pages/FollowUps'), () => import('./pages/Meetings'), () => import('./pages/Proposals'), () => import('./pages/LeadView'), () => import('./pages/admin/Overview'), () => import('./pages/admin/Reports')];
let prefetched = false;
function prefetchPages() {
  if (prefetched || typeof window === 'undefined') return; prefetched = true;
  const idle = (cb: () => void) => ((window as unknown as { requestIdleCallback?: (f: () => void) => void }).requestIdleCallback ?? ((f: () => void) => setTimeout(f, 1200)))(cb);
  idle(() => PREFETCH.reduce((p, f) => p.then(() => f().then(() => undefined, () => undefined)), Promise.resolve()));
}

/** Page-level guard mirroring the database rule (RLS / RPCs enforce it regardless): no permission → this role's home. */
function Need({ perm, staff, children }: { perm?: string | string[]; staff?: boolean; children: JSX.Element }) {
  const { can, loading } = usePerms(); const { isStaff } = useAuth(); const home = useHomePath();
  if (loading) return <Loading />;
  const ok = (!staff || isStaff) && (!perm || (Array.isArray(perm) ? perm.some(can) : can(perm)));
  return ok ? children : <Navigate to={home} replace />;
}

function Protected({ admin, children }: { admin?: boolean; children: JSX.Element }) {
  const { loading, session, profile, noAccess, isAdmin } = useAuth();
  const loc = useLocation();
  if (loading) return <BootScreen />;
  if (!session) return <Navigate to="/login/" replace state={{ from: loc.pathname + loc.search }} />;
  if (noAccess) return <NoAccessPage />;
  if (profile?.must_change_password && loc.pathname !== '/set-password/') return <Navigate to="/set-password/" replace />;
  if (admin && !isAdmin) return <Navigate to="/dashboard/" replace />;
  prefetchPages();
  return children;
}

export default function App() {
  useI18n(); // subscribe: a language switch re-renders the routed tree in place (no remount, drafts survive)
  useTerminologyVersion(); // …and so does an admin terminology change
  if (!configured) {
    return (
      <div className="auth-wrap"><div className="card auth-card">
        <h2>{t('Backend not configured')}</h2>
        <p className="muted">{t('No Supabase URL / public key is configured. Edit config.js in the deployed files (or set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY at build time) — see docs/SETUP.md.')}</p>
      </div></div>
    );
  }
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/login/*" element={<LoginPage />} />
        <Route path="/set-password/*" element={<SetPasswordPage />} />
        <Route element={<Protected><AppShell /></Protected>}>
          <Route path="/dashboard/*" element={<Need staff><Dashboard /></Need>} />
          <Route path="/management/*" element={<Need perm={['mgmt.dashboard', 'reports.view']}><Management /></Need>} />
          <Route path="/leads/" element={<Need perm="raw.leads"><Leads /></Need>} />
          <Route path="/leads/view/*" element={<Need perm="raw.leads"><LeadView /></Need>} />
          <Route path="/calls/*" element={<Need perm="raw.calls"><Calls /></Need>} />
          <Route path="/pipeline/*" element={<Need perm="raw.leads"><Pipeline /></Need>} />
          <Route path="/follow-ups/*" element={<Need perm="raw.followups"><FollowUps /></Need>} />
          <Route path="/meetings/*" element={<Need perm="raw.meetings"><Meetings /></Need>} />
          <Route path="/proposals/*" element={<Need perm="raw.proposals"><Proposals /></Need>} />
          <Route path="/settings/*" element={<SettingsPage />} />
        </Route>
        <Route element={<Protected admin><AppShell admin /></Protected>}>
          <Route path="/admin/" element={<AdminOverview />} />
          <Route path="/admin/users/*" element={<AdminUsers />} />
          <Route path="/admin/roles/*" element={<AdminRoles />} />
          <Route path="/admin/terminology/*" element={<AdminTerminology />} />
          <Route path="/admin/targets/*" element={<AdminTargets />} />
          <Route path="/admin/reports/:mode/*" element={<AdminReports />} />
          <Route path="/admin/analytics/:focus/*" element={<AdminAnalytics />} />
          <Route path="/admin/sync/*" element={<AdminSync />} />
          <Route path="/admin/audit/*" element={<AdminAudit />} />
          <Route path="/admin/config/*" element={<AdminConfig />} />
          <Route path="/admin/status/*" element={<AdminStatus />} />
          <Route path="/admin/export/*" element={<AdminExport />} />
        </Route>
        <Route path="/" element={<Navigate to="/dashboard/" replace />} />
        <Route path="*" element={<Navigate to="/dashboard/" replace />} />
      </Routes>
    </Suspense>
  );
}
