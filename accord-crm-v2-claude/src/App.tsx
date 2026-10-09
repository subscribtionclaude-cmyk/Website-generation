import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { configured } from './lib/supabase';
import { AppShell } from './components/Layout';
import { Loading } from './components/ui';
import { LoginPage, SetPasswordPage, NoAccessPage, BootScreen } from './pages/AuthPages';
import { t } from './lib/i18n';

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

function Protected({ admin, children }: { admin?: boolean; children: JSX.Element }) {
  const { loading, session, profile, noAccess, isAdmin } = useAuth();
  const loc = useLocation();
  if (loading) return <BootScreen />;
  if (!session) return <Navigate to="/login/" replace state={{ from: loc.pathname + loc.search }} />;
  if (noAccess) return <NoAccessPage />;
  if (profile?.must_change_password && loc.pathname !== '/set-password/') return <Navigate to="/set-password/" replace />;
  if (admin && !isAdmin) return <Navigate to="/dashboard/" replace />;
  return children;
}

export default function App() {
  if (!configured) {
    return (
      <div className="auth-wrap"><div className="card auth-card">
        <h2>{t('Backend not configured')}</h2>
        <p className="muted">No Supabase URL / public key is configured. Edit <code>config.js</code> in the deployed files (or set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> at build time) — see docs/SETUP.md.</p>
      </div></div>
    );
  }
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/login/*" element={<LoginPage />} />
        <Route path="/set-password/*" element={<SetPasswordPage />} />
        <Route element={<Protected><AppShell /></Protected>}>
          <Route path="/dashboard/*" element={<Dashboard />} />
          <Route path="/leads/" element={<Leads />} />
          <Route path="/leads/view/*" element={<LeadView />} />
          <Route path="/calls/*" element={<Calls />} />
          <Route path="/pipeline/*" element={<Pipeline />} />
          <Route path="/follow-ups/*" element={<FollowUps />} />
          <Route path="/meetings/*" element={<Meetings />} />
          <Route path="/proposals/*" element={<Proposals />} />
          <Route path="/settings/*" element={<SettingsPage />} />
        </Route>
        <Route element={<Protected admin><AppShell admin /></Protected>}>
          <Route path="/admin/" element={<AdminOverview />} />
          <Route path="/admin/users/*" element={<AdminUsers />} />
          <Route path="/admin/targets/*" element={<AdminTargets />} />
          <Route path="/admin/reports/:mode/*" element={<AdminReports />} />
          <Route path="/admin/analytics/:focus/*" element={<AdminAnalytics />} />
          <Route path="/admin/sync/*" element={<AdminSync />} />
          <Route path="/admin/audit/*" element={<AdminAudit />} />
          <Route path="/admin/config/*" element={<AdminConfig />} />
          <Route path="/admin/status/*" element={<AdminStatus />} />
        </Route>
        <Route path="/" element={<Navigate to="/dashboard/" replace />} />
        <Route path="*" element={<Navigate to="/dashboard/" replace />} />
      </Routes>
    </Suspense>
  );
}
