import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Building2, Phone, Columns3, CalendarClock, CalendarDays, FileText, Settings, ShieldCheck, LogOut, Moon, Sun,
  Users, Target, BarChart3, Presentation, PhoneCall, Handshake, Briefcase, GitBranch, RefreshCw, ScrollText, SlidersHorizontal, Activity, MoreHorizontal, ArrowLeft, CalendarRange, CalendarCheck2,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { Modal } from './ui';

function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try { const t = localStorage.getItem('accord-theme'); if (t === 'light' || t === 'dark') return t; } catch { /* ignore */ }
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('accord-theme', theme); } catch { /* ignore */ }
  }, [theme]);
  return { theme, toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) };
}

export function Logo({ dark }: { dark?: boolean }) {
  const { theme } = useTheme();
  const useDark = dark ?? theme === 'dark';
  return <img src={useDark ? '/brand/accord-logo-dark.png' : '/brand/accord-logo-light.png'} alt="ACCORD" width={150} height={86} />;
}

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
];

function Sidebar({ admin }: { admin?: boolean }) {
  const { profile, isAdmin, signOut } = useAuth();
  const { theme, toggle } = useTheme();
  return (
    <aside className="sidebar">
      <Link to={admin ? '/admin/' : '/dashboard/'} className="brand" aria-label="ACCORD CRM home"><Logo /></Link>
      {admin && <div className="admin-ribbon" style={{ margin: '0 6px 8px' }}><ShieldCheck size={13} /> <span className="hide-tablet">Management control centre</span></div>}
      <nav aria-label={admin ? 'Admin navigation' : 'Main navigation'}>
        {admin
          ? ADMIN_NAV.map((i) => typeof i === 'string'
            ? <div key={i} className="navsep">{i}</div>
            : <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => `navlink ${isActive ? 'active' : ''}`} title={i.label}>{i.icon}<span>{i.label}</span></NavLink>)
          : CRM_NAV.map((i) => <NavLink key={i.to} to={i.to} className={({ isActive }) => `navlink ${isActive ? 'active' : ''}`} title={i.label}>{i.icon}<span>{i.label}</span></NavLink>)}
      </nav>
      <div className="foot">
        {isAdmin && (admin
          ? <NavLink to="/dashboard/" className="navlink" title="Back to CRM"><ArrowLeft /><span>Back to CRM</span></NavLink>
          : <NavLink to="/admin/" className="navlink" title="Admin dashboard"><ShieldCheck /><span>Admin dashboard</span></NavLink>)}
        <NavLink to="/settings/" className="navlink" title="Profile & settings"><Settings /><span className="label">{profile?.full_name || profile?.email}</span></NavLink>
        <div className="row nowrap">
          <button className="btn ghost sm icon" onClick={toggle} aria-label="Toggle theme">{theme === 'dark' ? <Sun /> : <Moon />}</button>
          <button className="btn ghost sm icon" onClick={() => signOut()} aria-label="Sign out"><LogOut /></button>
        </div>
      </div>
    </aside>
  );
}

function MobileBar({ admin }: { admin?: boolean }) {
  const { isAdmin } = useAuth();
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
      <nav className="mobilebar" aria-label="Quick navigation">
        {primary.map((i) => <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => (isActive ? 'active' : '')}>{i.icon}{i.label.replace(' & Access', '')}</NavLink>)}
        <button onClick={() => setMore(true)} aria-label="More"><MoreHorizontal />More</button>
      </nav>
      {more && (
        <Modal title="More" onClose={() => setMore(false)}>
          <div className="col">
            {rest.map((i) => <NavLink key={i.to} to={i.to} className="navlink" onClick={() => setMore(false)}>{i.icon}<span>{i.label}</span></NavLink>)}
            {admin && <NavLink to="/dashboard/" className="navlink"><ArrowLeft /><span>Back to CRM</span></NavLink>}
          </div>
        </Modal>
      )}
    </>
  );
}

export function AppShell({ admin }: { admin?: boolean }) {
  return (
    <div className="shell">
      <Sidebar admin={admin} />
      <main className="main" id="main"><Outlet /></main>
      <MobileBar admin={admin} />
    </div>
  );
}
