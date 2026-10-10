import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, PhoneCall, GitBranch, Building2, ScrollText, Lock, RotateCcw } from 'lucide-react';
import { supabase, unwrap } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import { PageHead, Loading, ErrorNote, Switch } from '../../components/ui';
import { t } from '../../lib/i18n';

// Only business configuration that is safe to change at runtime is exposed here. Keys (stage keys, outcome keys,
// setting keys) are fixed; every write goes through RLS (admin only) and the audit trigger on each table.
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
interface Stage { key: string; label: string; position: number; active: boolean }
interface Outcome { key: string; label: string; kind: string; active: boolean }
const ALWAYS_ON = ['responded', 'did_not_respond'];

function Section({ icon, title, desc, children, aside }: { icon: React.ReactNode; title: string; desc: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="card" aria-label={title}>
      <div className="card-head"><div><h2 className="row">{icon} {title}</h2><div className="desc">{desc}</div></div>{aside}</div>
      {children}
    </section>
  );
}

export default function AdminConfig() {
  const qc = useQueryClient(); const toast = useToast();
  const q = useQuery({ queryKey: ['config'], queryFn: async () => {
    const [s, st, o] = await Promise.all([supabase.from('settings').select('*'), supabase.from('pipeline_stages').select('*').order('position'), supabase.from('call_outcomes').select('*').order('position')]);
    for (const r of [s, st, o]) if (r.error) throw new Error(r.error.message);
    return { settings: Object.fromEntries((s.data ?? []).map((x) => [x.key, x.value])) as Record<string, unknown>, stages: st.data as Stage[], outcomes: o.data as Outcome[] };
  } });
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [company, setCompany] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  async function run(key: string, fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(key);
    const r = await fn();
    setBusy('');
    if (r.error) toast(r.error.message, 'bad');
    else { toast(t('Saved'), 'ok'); qc.invalidateQueries({ queryKey: ['config'] }); qc.invalidateQueries({ queryKey: ['stages'] }); }
  }
  if (q.isLoading) return <Loading />;
  const wd = (q.data?.settings.working_days as number[]) ?? [0, 1, 2, 3, 4];
  const companyName = (q.data?.settings.company_name as string | undefined) ?? '';
  const companyDraft = company ?? companyName;
  const toggleDay = (i: number) => {
    if (wd.includes(i) && wd.length === 1) { toast(t('At least one working day is required'), 'bad'); return; }
    run('wd', () => supabase.from('settings').update({ value: wd.includes(i) ? wd.filter((x) => x !== i) : [...wd, i].sort() }).eq('key', 'working_days'));
  };
  return (
    <>
      <PageHead title="CRM configuration" sub="Business settings for the whole team. Every change here is audited."
        actions={<Link className="btn" to="/admin/audit/"><ScrollText /> {t('View audit log')}</Link>} />
      <ErrorNote error={q.error} />
      <div className="col" style={{ gap: 16, maxWidth: 980 }}>
        <Section icon={<CalendarDays size={16} />} title={t('Working days')} desc={t('Period call targets count only these days (Cairo calendar). Default Sunday–Thursday.')}
          aside={<span className="badge num">{t('{n} days / week', { n: wd.length })}</span>}>
          <div className="card-pad">
            <div className="chips" role="group" aria-label={t('Working days')}>
              {DOW.map((d, i) => (
                <button key={d} className={`chip ${wd.includes(i) ? 'on' : ''}`} aria-pressed={wd.includes(i)} disabled={busy === 'wd'} onClick={() => toggleDay(i)}
                  title={t(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][i])}>{t(d)}</button>
              ))}
            </div>
          </div>
        </Section>

        <Section icon={<PhoneCall size={16} />} title={t('Call outcomes')}
          desc={t('Responded and Didn\'t Respond are always on. Others can be switched on for future use; "kind" decides whether they count as responded.')}>
          {q.data?.outcomes.map((o) => (
            <div key={o.key} className="set-row">
              <div className="txt"><b>{t(o.label)}</b><span>{o.kind === 'responded' ? t('counts as responded') : t("counts as didn't respond")}</span></div>
              <div className="row nowrap">
                {ALWAYS_ON.includes(o.key) && <span className="badge" title={t('Always on')}><Lock size={11} /> {t('Always on')}</span>}
                <Switch label={t(o.label)} checked={o.active} disabled={ALWAYS_ON.includes(o.key) || busy === o.key}
                  onChange={(v) => run(o.key, () => supabase.from('call_outcomes').update({ active: v }).eq('key', o.key))} />
              </div>
            </div>
          ))}
        </Section>

        <Section icon={<GitBranch size={16} />} title={t('Pipeline stage labels')} desc={t('Stage keys are fixed; only display labels are configurable.')}>
          {q.data?.stages.map((s) => {
            const draft = labels[s.key] ?? s.label;
            const changed = draft !== s.label;
            return (
              <div key={s.key} className="set-row">
                <div className="txt" style={{ minWidth: 110 }}><code>{s.key}</code></div>
                <div className="row nowrap grow" style={{ justifyContent: 'flex-end', maxWidth: 420 }}>
                  <input value={draft} onChange={(e) => setLabels({ ...labels, [s.key]: e.target.value })} aria-label={t('Label for {key}', { key: s.key })} />
                  {changed && <button className="btn sm ghost icon" title={t('Undo')} aria-label={t('Undo')} onClick={() => { const n = { ...labels }; delete n[s.key]; setLabels(n); }}><RotateCcw /></button>}
                  <button className="btn sm" disabled={!changed || !draft.trim() || busy === s.key}
                    onClick={() => run(s.key, () => supabase.from('pipeline_stages').update({ label: draft.trim() }).eq('key', s.key)).then(() => { const n = { ...labels }; delete n[s.key]; setLabels(n); })}>{t('Save')}</button>
                </div>
              </div>
            );
          })}
        </Section>

        <Section icon={<Building2 size={16} />} title={t('Organisation')} desc={t('Organisation details kept with the CRM configuration.')}>
          <div className="set-row">
            <div className="txt"><b>{t('Company display name')}</b><span>{t('Informational — does not affect data or access.')}</span></div>
            <div className="row nowrap grow" style={{ justifyContent: 'flex-end', maxWidth: 460 }}>
              <input value={companyDraft} onChange={(e) => setCompany(e.target.value)} aria-label={t('Company display name')} />
              <button className="btn sm" disabled={!companyDraft.trim() || companyDraft === companyName || busy === 'company'}
                onClick={() => run('company', () => supabase.from('settings').update({ value: companyDraft.trim() }).eq('key', 'company_name')).then(() => setCompany(null))}>{t('Save')}</button>
            </div>
          </div>
          <div className="set-row">
            <div className="txt"><b>{t('Business time zone')}</b><span>{t('Fixed. All business-date logic uses the Cairo calendar.')}</span></div>
            <span className="badge"><bdi className="ltr">{String(q.data?.settings.timezone ?? 'Africa/Cairo')}</bdi></span>
          </div>
        </Section>
      </div>
    </>
  );
}
export { unwrap };
