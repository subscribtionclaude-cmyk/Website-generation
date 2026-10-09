import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { User, Palette, Languages, ShieldCheck, Info, Sun, Moon, Monitor, LogOut, Check, MonitorSmartphone } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { useTheme, type ThemePref } from '../lib/theme';
import { useI18n, LANGS, t } from '../lib/i18n';
import { PageHead, Field, ErrorNote, BusyButton, Segmented } from '../components/ui';
import { initials } from '../components/Layout';
import { ROLE_LABEL } from '../lib/labels';
import { TZ } from '../lib/cairo';

type Section = 'profile' | 'appearance' | 'language' | 'security' | 'about';
const SECTIONS: { key: Section; label: string; icon: ReactNode }[] = [
  { key: 'profile', label: 'Profile', icon: <User /> },
  { key: 'appearance', label: 'Appearance', icon: <Palette /> },
  { key: 'language', label: 'Language', icon: <Languages /> },
  { key: 'security', label: 'Security', icon: <ShieldCheck /> },
  { key: 'about', label: 'About', icon: <Info /> },
];

function Panel({ title, desc, children, foot }: { title: string; desc?: string; children: ReactNode; foot?: ReactNode }) {
  return (
    <section className="card" aria-label={title}>
      <div className="card-head"><div><h2>{title}</h2>{desc && <div className="desc">{desc}</div>}</div></div>
      {children}
      {foot && <div className="dialog-foot" style={{ borderRadius: '0 0 var(--radius) var(--radius)' }}>{foot}</div>}
    </section>
  );
}

export default function SettingsPage() {
  const [sp, setSp] = useSearchParams();
  const section = (SECTIONS.find((s) => s.key === sp.get('section'))?.key ?? 'profile') as Section;
  return (
    <>
      <PageHead title="Settings" sub="Your profile, appearance, language and security" />
      <div className="settings-layout">
        <nav className="settings-nav" aria-label={t('Settings sections')}>
          {SECTIONS.map((s) => (
            <button key={s.key} type="button" className={`navlink ${section === s.key ? 'active' : ''}`} aria-current={section === s.key ? 'page' : undefined}
              onClick={() => setSp(s.key === 'profile' ? {} : { section: s.key }, { replace: true })}>{s.icon}<span>{t(s.label)}</span></button>
          ))}
        </nav>
        <div className="settings-body">
          {section === 'profile' && <ProfileSection />}
          {section === 'appearance' && <AppearanceSection />}
          {section === 'language' && <LanguageSection />}
          {section === 'security' && <SecuritySection />}
          {section === 'about' && <AboutSection />}
        </div>
      </div>
    </>
  );
}

function ProfileSection() {
  const { profile, refreshProfile } = useAuth(); const toast = useToast();
  const [name, setName] = useState(profile!.full_name); const [phone, setPhone] = useState(profile!.phone ?? '');
  const [busy, setBusy] = useState(false);
  const dirty = name !== profile!.full_name || phone !== (profile!.phone ?? '');
  async function saveProfile() {
    if (!name.trim()) { toast(t('Name is required'), 'bad'); return; }
    setBusy(true);
    const { error } = await supabase.rpc('update_my_profile', { p_full_name: name.trim(), p_phone: phone.trim() || null });
    setBusy(false);
    if (error) toast(error.message, 'bad'); else { await refreshProfile(); toast(t('Profile saved'), 'ok'); }
  }
  return (
    <Panel title={t('Profile')} desc={t('How you appear to your team across the CRM.')}
      foot={<BusyButton className="btn primary" busy={busy} disabled={!dirty} onClick={saveProfile}>{t('Save changes')}</BusyButton>}>
      <div className="card-pad col" style={{ gap: 16 }}>
        <div className="row nowrap" style={{ gap: 14 }}>
          <span className="avatar lg" aria-hidden="true">{initials(name || profile!.email)}</span>
          <div className="col" style={{ gap: 2, minWidth: 0 }}>
            <b style={{ fontSize: 16 }}>{profile!.full_name || profile!.email}</b>
            <span className="muted small"><bdi className="ltr">{profile!.email}</bdi></span>
            <span><span className="badge stage">{ROLE_LABEL[profile!.role]}</span></span>
          </div>
        </div>
        <div className="form-grid">
          <Field label="Full name"><input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></Field>
          <Field label="Phone"><input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" /></Field>
          <Field label="Email" full><input value={profile!.email} disabled type="email" /></Field>
        </div>
        <span className="hint">{t('Your email and role are managed by an administrator.')}</span>
      </div>
    </Panel>
  );
}

function AppearanceSection() {
  const { pref, theme, setPref } = useTheme();
  const opts: { key: ThemePref; label: string; icon: ReactNode }[] = [
    { key: 'light', label: 'Light', icon: <Sun /> }, { key: 'dark', label: 'Dark', icon: <Moon /> }, { key: 'system', label: 'System', icon: <Monitor /> },
  ];
  return (
    <Panel title={t('Appearance')} desc={t('Choose a theme. “System” follows your device setting automatically.')}>
      <div className="card-pad col" style={{ gap: 14 }}>
        <div className="theme-cards" role="radiogroup" aria-label={t('Theme')}>
          {opts.map((o) => (
            <button key={o.key} type="button" role="radio" aria-checked={pref === o.key} className="theme-card" onClick={() => setPref(o.key)} data-testid={`theme-${o.key}`}>
              <span className={`pv ${o.key}`} aria-hidden="true"><i className="pv-side" /><span className="pv-main"><i /><i /><i /></span></span>
              <span className="tc-label">{o.icon}{t(o.label)}{pref === o.key && <Check style={{ marginInlineStart: 'auto', color: 'var(--primary-text)' }} />}</span>
            </button>
          ))}
        </div>
        <span className="hint">{t('Currently showing: {theme}. Saved on this device.', { theme: t(theme === 'dark' ? 'Dark' : 'Light') })}</span>
      </div>
    </Panel>
  );
}

function LanguageSection() {
  const { lang, setLang } = useI18n();
  return (
    <Panel title={t('Language & region')} desc={t('Interface language. Data (company names, notes) is shown as entered.')}>
      <div className="set-row">
        <div className="txt"><b>{t('Language')}</b><span>{t('Arabic switches the layout to right-to-left.')}</span></div>
        <Segmented label={t('Language')} value={lang} onChange={setLang} options={LANGS.map((l) => ({ key: l.key, label: l.native }))} />
      </div>
      <div className="set-row">
        <div className="txt"><b>{t('Business time zone')}</b><span>{t('All dates, targets and “today” use the Cairo calendar.')}</span></div>
        <span className="badge"><bdi className="ltr">{TZ}</bdi></span>
      </div>
      <div className="set-row">
        <div className="txt"><b>{t('Working week')}</b><span>{t('Configured by administrators (CRM configuration).')}</span></div>
        <span className="muted small">{t('Sunday – Thursday (default)')}</span>
      </div>
    </Panel>
  );
}

function SecuritySection() {
  const { signOut, session } = useAuth(); const toast = useToast();
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState(''); const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false); const [busyOthers, setBusyOthers] = useState(false);
  async function changePw() {
    setErr(null);
    if (pw.length < 12) { setErr(new Error(t('Use at least 12 characters'))); return; }
    if (pw !== pw2) { setErr(new Error(t('Passwords do not match'))); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) setErr(error); else { setPw(''); setPw2(''); toast(t('Password changed'), 'ok'); }
  }
  async function signOutOthers() {
    setBusyOthers(true);
    const { error } = await supabase.auth.signOut({ scope: 'others' });
    setBusyOthers(false);
    if (error) toast(error.message, 'bad'); else toast(t('Signed out of all other devices'), 'ok');
  }
  const strength = pw.length === 0 ? null : pw.length < 12 ? 'bad' : pw.length < 16 ? 'warn' : 'ok';
  return (
    <>
      <Panel title={t('Change password')} desc={t('Passwords are handled by Supabase Auth and are never stored by this app.')}
        foot={<BusyButton className="btn primary" busy={busy} disabled={!pw || !pw2} onClick={changePw}>{t('Change password')}</BusyButton>}>
        <form className="card-pad col" style={{ gap: 14 }} onSubmit={(e) => { e.preventDefault(); changePw(); }}>
          <input type="email" autoComplete="username" value={session?.user.email ?? ''} readOnly hidden />
          <div className="form-grid">
            <Field label="New password"><input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
            <Field label="Repeat"><input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
          </div>
          <div className="row small">
            {strength && <span className={`badge ${strength}`}>{strength === 'bad' ? t('Too short') : strength === 'warn' ? t('OK') : t('Strong')}</span>}
            <span className="hint">{t('At least 12 characters. A short sentence is easier to remember.')}</span>
          </div>
          <ErrorNote error={err} />
        </form>
      </Panel>
      <Panel title={t('Sessions')}>
        <div className="set-row">
          <div className="txt"><b>{t('Sign out of other devices')}</b><span>{t('Ends every other session (other browsers, iPad, phone). This device stays signed in.')}</span></div>
          <BusyButton className="btn" busy={busyOthers} onClick={signOutOthers}><MonitorSmartphone /> {t('Sign out others')}</BusyButton>
        </div>
        <div className="set-row">
          <div className="txt"><b>{t('Sign out')}</b><span>{t('Sign out of ACCORD CRM on this device.')}</span></div>
          <button className="btn danger" onClick={() => signOut()}><LogOut className="flip-rtl" /> {t('Sign out')}</button>
        </div>
      </Panel>
    </>
  );
}

function AboutSection() {
  const standalone = typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
  const host = (() => { try { return new URL((window as unknown as { ACCORD_CONFIG?: { supabaseUrl?: string } }).ACCORD_CONFIG?.supabaseUrl ?? import.meta.env.VITE_SUPABASE_URL ?? '').host; } catch { return ''; } })();
  return (
    <Panel title={t('About ACCORD CRM')}>
      <div className="card-pad">
        <dl className="kv">
          <dt>{t('Application')}</dt><dd>ACCORD CRM V2</dd>
          <dt>{t('Version')}</dt><dd><bdi className="ltr">{__APP_VERSION__} · {__BUILD_DATE__}</bdi></dd>
          <dt>{t('Time zone')}</dt><dd><bdi className="ltr">{TZ}</bdi></dd>
          {host && <><dt>{t('Backend')}</dt><dd><bdi className="ltr mono">{host}</bdi></dd></>}
          <dt>{t('Installed app')}</dt><dd>{standalone ? <span className="badge ok">{t('Running as installed app')}</span> : <span className="muted">{t('Running in the browser')}</span>}</dd>
        </dl>
      </div>
      <div className="set-row">
        <div className="txt"><b>{t('Install on iPad / iPhone')}</b><span>{t('In Safari tap Share → Add to Home Screen. On Android / desktop Chrome use “Install app”.')}</span></div>
      </div>
    </Panel>
  );
}
