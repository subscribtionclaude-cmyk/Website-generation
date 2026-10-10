import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Building2, Phone, Columns3, CalendarClock, CalendarDays, FileText, Settings, ShieldCheck, LogOut, Moon, Sun,
  Users, Target, Presentation, PhoneCall, Handshake, Briefcase, GitBranch, RefreshCw, ScrollText, SlidersHorizontal, Activity, MoreHorizontal, ArrowLeft, CalendarRange, CalendarCheck2,
  Monitor, Languages, Download,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useTheme, type ThemePref } from '../lib/theme';
import { useI18n, t } from '../lib/i18n';
import { ROLE_LABEL } from '../lib/labels';
import { Modal, Segmented } from './ui';

/** ACCORD logo; the variant always follows the ACTIVE theme (single source: ThemeProvider). */
export function Logo({ dark, className }: { dark?: boolean; className?: string }) {
  const { theme } = useTheme();
  const useDark = dark ?? theme === 'dark';
  return <img className={className} src={useDark ? '/brand/accord-logo-dark.png' : '/brand/accord-logo-light.png'} alt="ACCORD" width={146} height={70} />;
}
/** Official ACCORD app icon (compact contexts only); the variant follows the active theme. */
export function AppIcon({ className = 'mark', size = 40 }: { className?: string; size?: number }) {
  const { theme } = useTheme();
  return <img className={className} src={theme === 'dark' ? '/brand/accord-icon-dark.png' : '/brand/accord-icon-light.png'} alt="ACCORD" width={size} height={size} />;
}
export const initials = (name?: string | null) => (name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';

interface Item { to: string; label: string; icon: ReactNode; end?: boolean }
const CRM_NAV: Item[] = [
  { to: '/dashboard/', label: 'Dashboard', icon: <LayoutDashboard /> },
  { to: '/leads/', label: 'Leads', icon: <Building2 /> },
  { to: '/calls/', label: 'Calls', icon: <Phone /> },
  { to: '/pipeline/', label: 'Pipeline', icon: <Columns3 /> },
  { to: '/follow-ups/', label: 'Follow-ups', icon: <CalendarClock /> },
  { to: '/meetings/', label: 'Meetings', icon: <CalendarDays /> },
  { to: '/proposals/', label: 'Proposals', icon: <FileText /> },
];
const ADMIN_NAV: (Item | string)[] = [
  { to: '/admin/', label: 'Overview', icon: <ShieldCheck />, end: true },
  { to: '/admin/users/', label: 'Users & Access', icon: <Users /> },
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
  'System',
  { to: '/admin/sync/', label: 'Google Sheet Sync', icon: <RefreshCw /> },
  { to: '/admin/audit/', label: 'Audit Log', icon: <ScrollText /> },
  { to: '/admin/config/', label: 'CRM Configuration', icon: <SlidersHorizontal /> },
  { to: '/admin/status/', label: 'System Status', icon: <Activity /> },
  { to: '/admin/export/', label: 'Data Export', icon: <Download /> },
];

const navCls = ({ isActive }: { isActive: boolean }) => `navlink ${isActive ? 'active' : ''}`;
function NavItem({ i, onClick }: { i: Item; onClick?: () => void }) {
  return <NavLink to={i.to} end={i.end} className={navCls} title={t(i.label)} onClick={onClick}>{i.icon}<span>{t(i.label)}</span></NavLink>;
}

function Sidebar({ admin }: { admin?: boolean }) {
  const { profile, isAdmin, signOut } = useAuth();
  const { theme, toggle } = useTheme();
  return (
    <aside className="sidebar">
      <Link to={admin ? '/admin/' : '/dashboard/'} className="brand" aria-label={t('ACCORD CRM home')}><Logo className="full" /><AppIcon /></Link>
      {admin && <div className="admin-ribbon" style={{ margin: '0 4px 10px' }} title={t('Management control centre')}><ShieldCheck size={13} /> <span>{t('Management control centre')}</span></div>}
      <nav aria-label={admin ? t('Admin navigation') : t('Main navigation')}>
        {admin
          ? ADMIN_NAV.map((i) => typeof i === 'string' ? <div key={i} className="navsep">{t(i)}</div> : <NavItem key={i.to} i={i} />)
          : CRM_NAV.map((i) => <NavItem key={i.to} i={i} />)}
      </nav>
      <div className="foot">
        {isAdmin && (admin
          ? <NavLink to="/dashboard/" className="navlink" title={t('Back to CRM')}><ArrowLeft className="flip-rtl" /><span>{t('Back to CRM')}</span></NavLink>
          : <NavLink to="/admin/" className="navlink" title={t('Admin dashboard')}><ShieldCheck /><span>{t('Admin dashboard')}</span></NavLink>)}
        <NavLink to="/settings/" className={({ isActive }) => `usercard ${isActive ? 'active' : ''}`} title={t('Profile & settings')}>
          <span className="avatar" aria-hidden="true">{initials(profile?.full_name || profile?.email)}</span>
          <span className="who"><b>{profile?.full_name || profile?.email}</b><span>{profile ? ROLE_LABEL[profile.role] : ''} · {t('Settings')}</span></span>
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
  const primary = admin
    ? [ADMIN_NAV[0], ADMIN_NAV[1], ADMIN_NAV[2], ADMIN_NAV[4]] as Item[]
    : [CRM_NAV[0], CRM_NAV[1], CRM_NAV[2], CRM_NAV[4]];
  const rest: Item[] = admin
    ? (ADMIN_NAV.filter((i) => typeof i !== 'string') as Item[]).filter((i) => !primary.includes(i))
    : [...CRM_NAV.filter((i) => !primary.includes(i)), { to: '/settings/', label: 'Settings', icon: <Settings /> }, ...(isAdmin ? [{ to: '/admin/', label: 'Admin dashboard', icon: <ShieldCheck /> }] : [])];
  return (
    <>
      <nav className="mobilebar" aria-label={t('Quick navigation')}>
        {primary.map((i) => <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => (isActive ? 'active' : '')}>{i.icon}{t(i.label.replace(' & Access', ''))}</NavLink>)}
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

export function AppShell({ admin }: { admin?: boolean }) {
  return (
    <div className="shell">
      <Sidebar admin={admin} />
      <main className="main" id="main">
        <div className="mobile-top"><Link to={admin ? '/admin/' : '/dashboard/'} aria-label={t('ACCORD CRM home')}><Logo /></Link><MobileTopActions /></div>
        <Outlet />
      </main>
      <MobileBar admin={admin} />
    </div>
  );
}
