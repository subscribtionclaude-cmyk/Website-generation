import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Building2, Phone, Columns3, CalendarClock, CalendarDays, FileText, Settings, ShieldCheck, LogOut, Moon, Sun,
  Users, Target, Presentation, PhoneCall, Handshake, Briefcase, GitBranch, RefreshCw, ScrollText, SlidersHorizontal, Activity, MoreHorizontal, ArrowLeft, CalendarRange, CalendarCheck2,
  Monitor, Languages, Download, KeyRound, Type, Eye, X as XIcon, LineChart,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useTheme, type ThemePref } from '../lib/theme';
import { useI18n, t } from '../lib/i18n';
import { ROLE_LABEL } from '../lib/labels';
import { Modal, Segmented } from './ui';
import { usePerms } from '../lib/perms';
import { term } from '../lib/terminology';
import { usePreviewRole, setPreviewRole } from '../lib/preview';

/** ACCORD logo; the variant always follows the ACTIVE theme (single source: ThemeProvider). */
export function Logo({ dark, className }: { dark?: boolean; className?: string }) {
  const { theme } = useTheme();
  const useDark = dark ?? theme === 'dark';
  return <img className={className} src={useDark ? '/brand/accord-logo-dark.png' : '/brand/accord-logo-light.png'} alt="ACCORD" width={146} height={70} />;
}
/** Final ACCORD compact/app icon (compact contexts only — the full wordmark stays wherever there is room). */
export function AppIcon({ className = 'mark', size = 40 }: { className?: string; size?: number }) {
  return <img className={className} src="/brand/accord-app-icon.png" alt="ACCORD" width={size} height={size} />;
}
export const initials = (name?: string | null) => (name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';

interface Item { to: string; label: string; icon: ReactNode; end?: boolean; raw?: boolean }
type Can = (p: string) => boolean;
// every CRM page is shown only when the EFFECTIVE permissions allow it (the database enforces the same rule)
const CRM_NAV: (Item & { show: (can: Can, staff: boolean) => boolean })[] = [
  { to: '/dashboard/', label: 'Dashboard', icon: <LayoutDashboard />, show: (_c, staff) => staff },
  { to: '/management/', label: 'management_dashboard', raw: true, icon: <LineChart />, show: (c) => c('mgmt.dashboard') || c('reports.view') },
  { to: '/leads/', label: 'Leads', icon: <Building2 />, show: (c) => c('raw.leads') },
  { to: '/calls/', label: 'Calls', icon: <Phone />, show: (c) => c('raw.calls') },
  { to: '/pipeline/', label: 'Pipeline', icon: <Columns3 />, show: (c) => c('raw.leads') },
  { to: '/follow-ups/', label: 'Follow-ups', icon: <CalendarClock />, show: (c) => c('raw.followups') },
  { to: '/meetings/', label: 'Meetings', icon: <CalendarDays />, show: (c) => c('raw.meetings') },
  { to: '/proposals/', label: 'Proposals', icon: <FileText />, show: (c) => c('raw.proposals') },
];
/** CRM navigation for the signed-in (or previewed) role. */
export function useCrmNav(): Item[] {
  const { can } = usePerms(); const { isStaff } = useAuth();
  return CRM_NAV.filter((i) => i.show(can, isStaff));
}
/** Where "home" is for this role: Sales/Admin → personal dashboard; Management Viewer → management dashboard. */
export function useHomePath(): string {
  const { can } = usePerms(); const { isStaff } = useAuth();
  return isStaff ? '/dashboard/' : can('mgmt.dashboard') || can('reports.view') ? '/management/' : '/settings/';
}
const ADMIN_NAV: (Item | string)[] = [
  { to: '/admin/', label: 'Overview', icon: <ShieldCheck />, end: true },
  'People & access',
  { to: '/admin/users/', label: 'Users & Access', icon: <Users /> },
  { to: '/admin/roles/', label: 'Roles & Permissions', icon: <KeyRound /> },
  { to: '/admin/targets/', label: 'User Targets', icon: <Target /> },
  'Reports',
  { to: '/admin/reports/daily/', label: 'Daily Reports', icon: <CalendarCheck2 /> },
  { to: '/admin/reports/weekly/', label: 'Weekly Reports', icon: <CalendarRange /> },
  { to: '/admin/reports/monthly/', label: 'Monthly Reports', icon: <CalendarDays /> },
  { to: '/admin/reports/board/', label: 'Board / Executive', icon: <Presentation /> },
  'Analytics',
  { to: '/admin/analytics/calls/', label: 'Calls Analytics', icon: <PhoneCall /> },
  { to: '/admin/analytics/meetings/', label: 'Meetings Analytics', icon: <Handshake /> },
  { to: '/admin/analytics/commercial/', label: 'Commercial', icon: <Briefcase /> },
  { to: '/admin/analytics/pipeline/', label: 'Pipeline Analytics', icon: <GitBranch /> },
  'Configuration',
  { to: '/admin/config/', label: 'CRM Configuration', icon: <SlidersHorizontal /> },
  { to: '/admin/terminology/', label: 'Terminology', icon: <Type /> },
  'Integrations',
  { to: '/admin/sync/', label: 'Google Sheet Sync', icon: <RefreshCw /> },
  'System',
  { to: '/admin/status/', label: 'System Status', icon: <Activity /> },
  { to: '/admin/audit/', label: 'Audit Log', icon: <ScrollText /> },
  { to: '/admin/export/', label: 'Data Export', icon: <Download /> },
];

const navCls = ({ isActive }: { isActive: boolean }) => `navlink ${isActive ? 'active' : ''}`;
function NavItem({ i, onClick }: { i: Item; onClick?: () => void }) {
  const label = i.raw ? term(i.label as Parameters<typeof term>[0]) : t(i.label);
  return <NavLink to={i.to} end={i.end} className={navCls} title={label} onClick={onClick}>{i.icon}<span>{label}</span></NavLink>;
}

function Sidebar({ admin }: { admin?: boolean }) {
  const { profile, isAdmin, signOut, role } = useAuth();
  const { theme, toggle } = useTheme();
  const nav = useCrmNav(); const home = useHomePath();
  return (
    <aside className="sidebar">
      <Link to={admin ? '/admin/' : home} className="brand" aria-label={t('ACCORD CRM home')}><Logo className="full" /><AppIcon /></Link>
      {admin && <div className="admin-ribbon" style={{ margin: '0 4px 10px' }} title={t('Management control centre')}><ShieldCheck size={13} /> <span>{t('Management control centre')}</span></div>}
      <nav aria-label={admin ? t('Admin navigation') : t('Main navigation')}>
        {admin
          ? ADMIN_NAV.map((i) => typeof i === 'string' ? <div key={i} className="navsep">{t(i)}</div> : <NavItem key={i.to} i={i} />)
          : nav.map((i) => <NavItem key={i.to} i={i} />)}
      </nav>
      <div className="foot">
        {isAdmin && (admin
          ? <NavLink to="/dashboard/" className="navlink" title={t('Back to CRM')}><ArrowLeft className="flip-rtl" /><span>{t('Back to CRM')}</span></NavLink>
          : <NavLink to="/admin/" className="navlink" title={t('Admin dashboard')}><ShieldCheck /><span>{t('Admin dashboard')}</span></NavLink>)}
        <NavLink to="/settings/" className={({ isActive }) => `usercard ${isActive ? 'active' : ''}`} title={t('Profile & settings')}>
          <span className="avatar" aria-hidden="true">{initials(profile?.full_name || profile?.email)}</span>
          <span className="who"><b>{profile?.full_name || profile?.email}</b><span>{role ? ROLE_LABEL[role] : ''} · {t('Settings')}</span></span>
        </NavLink>
        <div className="foot-actions">
          <button className="btn ghost sm icon" onClick={toggle} aria-label={t('Toggle theme')} title={theme === 'dark' ? t('Switch to light mode') : t('Switch to dark mode')}>{theme === 'dark' ? <Sun /> : <Moon />}</button>
          <LangToggle />
          <button className="btn ghost sm icon" onClick={() => signOut()} aria-label={t('Sign out')} title={t('Sign out')}><LogOut className="flip-rtl" /></button>
        </div>
      </div>
    </aside>
  );
}

/** Appearance + language quick controls (mobile "More" sheet; also reused on the auth screens). */
export function QuickPrefs() {
  const { pref, setPref } = useTheme();
  const { lang, setLang } = useI18n();
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row spread"><span className="label">{t('Appearance')}</span>
        <Segmented<ThemePref> label={t('Appearance')} value={pref} onChange={setPref} options={[
          { key: 'system', label: t('System'), icon: <Monitor /> }, { key: 'light', label: t('Light'), icon: <Sun /> }, { key: 'dark', label: t('Dark'), icon: <Moon /> }]} /></div>
      <div className="row spread"><span className="label">{t('Language')}</span>
        <Segmented label={t('Language')} value={lang} onChange={setLang} options={[{ key: 'en', label: 'English' }, { key: 'ar', label: 'العربية' }]} /></div>
    </div>
  );
}

/** Compact theme + language buttons for screens without the sidebar (login, set password). */
export function AuthTools() {
  const { theme, toggle } = useTheme();
  const { lang, setLang } = useI18n();
  return (
    <div className="auth-tools">
      <button type="button" className="btn ghost sm" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')} aria-label={t('Language')}><Languages />{lang === 'ar' ? 'English' : 'العربية'}</button>
      <button type="button" className="btn ghost sm icon" onClick={toggle} aria-label={t('Switch theme')}>{theme === 'dark' ? <Sun /> : <Moon />}</button>
    </div>
  );
}

function MobileBar({ admin }: { admin?: boolean }) {
  const { isAdmin, signOut } = useAuth();
  const [more, setMore] = useState(false);
  const loc = useLocation();
  useEffect(() => setMore(false), [loc.pathname]);
  const nav = useCrmNav();
  const adminItems = ADMIN_NAV.filter((i) => typeof i !== 'string') as Item[];
  const PRIMARY_ADMIN = ['/admin/', '/admin/users/', '/admin/targets/', '/admin/reports/daily/'];
  const PRIMARY_CRM = ['/dashboard/', '/management/', '/leads/', '/calls/', '/follow-ups/'];
  const primary = admin
    ? PRIMARY_ADMIN.map((to) => adminItems.find((i) => i.to === to)!).filter(Boolean)
    : nav.filter((i) => PRIMARY_CRM.includes(i.to)).slice(0, 4);
  const rest: Item[] = admin
    ? adminItems.filter((i) => !primary.includes(i))
    : [...nav.filter((i) => !primary.includes(i)), { to: '/settings/', label: 'Settings', icon: <Settings /> }, ...(isAdmin ? [{ to: '/admin/', label: 'Admin dashboard', icon: <ShieldCheck /> }] : [])];
  return (
    <>
      <nav className="mobilebar" aria-label={t('Quick navigation')}>
        {primary.map((i) => <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => (isActive ? 'active' : '')}>{i.icon}{i.raw ? term(i.label as Parameters<typeof term>[0]) : t(i.label.replace(' & Access', ''))}</NavLink>)}
        <button onClick={() => setMore(true)} aria-label={t('More')}><MoreHorizontal />{t('More')}</button>
      </nav>
      {more && (
        <Modal title={t('More')} onClose={() => setMore(false)}>
          <div className="col" style={{ gap: 2 }}>
            {rest.map((i) => <NavItem key={i.to} i={i} onClick={() => setMore(false)} />)}
            {admin && <NavLink to="/dashboard/" className="navlink"><ArrowLeft className="flip-rtl" /><span>{t('Back to CRM')}</span></NavLink>}
          </div>
          <div className="card card-pad"><QuickPrefs /></div>
          <button className="btn danger" onClick={() => signOut()}><LogOut className="flip-rtl" /> {t('Sign out')}</button>
        </Modal>
      )}
    </>
  );
}

/** One-tap English ⇄ العربية switch (same central i18n state as Settings → Language); the current route is kept. */
export function LangToggle({ large }: { large?: boolean }) {
  const { lang, setLang } = useI18n();
  const next = lang === 'ar' ? 'en' : 'ar';
  const name = next === 'ar' ? t('Switch language to Arabic') : t('Switch language to English');
  return (
    <button className={`btn ghost ${large ? '' : 'sm'} lang-btn`} onClick={() => setLang(next)} aria-label={name} title={name} data-testid="lang-toggle">
      <Languages /><span lang={next}>{next === 'ar' ? 'ع' : 'EN'}</span>
    </button>
  );
}

function MobileTopActions() {
  const { profile } = useAuth();
  const { theme, toggle } = useTheme();
  return (
    <div className="row nowrap" style={{ gap: 4 }}>
      <LangToggle large />
      <button className="btn ghost icon" onClick={toggle} aria-label={t('Switch theme')}>{theme === 'dark' ? <Sun /> : <Moon />}</button>
      <Link to="/settings/" aria-label={t('Profile & settings')}><span className="avatar">{initials(profile?.full_name || profile?.email)}</span></Link>
    </div>
  );
}

/** "Preview as role" banner — the preview is UI-only and read-only; the admin identity never changes. */
function PreviewBanner() {
  const { realAdmin } = useAuth(); const preview = usePreviewRole(); const navigate = useNavigate();
  if (!realAdmin || !preview) return null;
  return (
    <div className="preview-banner" role="status" data-testid="preview-banner">
      <Eye /><span><b>{t('Previewing {role}', { role: ROLE_LABEL[preview] })}</b> · {t('Read-only preview of navigation and dashboards. Your own access is unchanged and nothing can be saved.')}</span>
      <button className="btn sm" onClick={() => { setPreviewRole(null); navigate('/admin/roles/'); }} data-testid="exit-preview"><XIcon /> {t('Exit preview')}</button>
    </div>
  );
}

export function AppShell({ admin }: { admin?: boolean }) {
  const home = useHomePath();
  return (
    <div className="shell">
      <Sidebar admin={admin} />
      <main className="main" id="main">
        <PreviewBanner />
        <div className="mobile-top"><Link to={admin ? '/admin/' : home} aria-label={t('ACCORD CRM home')}><AppIcon size={38} /></Link><MobileTopActions /></div>
        <Outlet />
      </main>
      <MobileBar admin={admin} />
    </div>
  );
}
