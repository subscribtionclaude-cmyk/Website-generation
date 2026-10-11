import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { PageHead, ErrorNote } from '../../components/ui';
import { useToast } from '../../lib/toast';
import { t } from '../../lib/i18n';
import { AR } from '../../lib/i18n-ar';
import { TERM_DEFAULTS, getTerminology, setTerminology, useTerminologyVersion, type TermKey, type Terminology } from '../../lib/terminology';

// Display labels only. Changing "Sales" to "Business Development" never touches role keys or any business record.
const HELP: Record<TermKey, string> = {
  role_admin: 'Shown wherever the administrator role is named.',
  role_sales: 'The operational employee role (stored internally as bd_executive).',
  role_viewer: 'Management / HR / authorised observers — read-only reporting role.',
  sales_team: 'Used for the team performance table and reports.',
  sales_department: 'Used for department-level totals.',
  management_dashboard: 'Name of the management dashboard page and menu item.',
};

export default function AdminTerminology() {
  useTerminologyVersion();
  const qc = useQueryClient(); const toast = useToast();
  const [form, setForm] = useState<Terminology>(() => getTerminology());
  const [err, setErr] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { setForm(getTerminology()); }, []);
  const set = (k: TermKey, lang: 'en' | 'ar', v: string) => setForm((f) => ({ ...f, [k]: { ...f[k], [lang]: v } }));

  async function save() {
    setErr(null); setBusy(true);
    try {
      const { error } = await supabase.rpc('admin_set_terminology', { p_labels: form });
      if (error) throw new Error(error.message);
      const clean: Terminology = {};
      for (const k of Object.keys(TERM_DEFAULTS) as TermKey[]) { const en = form[k]?.en?.trim() ?? ''; const ar = form[k]?.ar?.trim() ?? ''; if (en || ar) clean[k] = { en, ar }; }
      setTerminology(clean); qc.setQueryData(['terminology'], clean);
      toast(t('Terminology saved'), 'ok');
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }

  return (
    <>
      <PageHead title={t('Terminology')} sub={t('Rename how roles and teams are displayed, in English and Arabic. Display labels only — roles and data are never changed. Leave a field empty to use the default.')}
        actions={<button className="btn primary" disabled={busy} onClick={save} data-testid="terminology-save">{t('Save')}</button>} />
      <ErrorNote error={err} />
      <div className="card card-pad col" style={{ gap: 16 }}>
        {(Object.keys(TERM_DEFAULTS) as TermKey[]).map((k) => (
          <div key={k} className="term-row" data-testid={`term-${k}`}>
            <div><b>{t(TERM_DEFAULTS[k])}</b><div className="muted small">{t(HELP[k])}</div></div>
            <label className="field"><span className="label">English</span><input dir="ltr" lang="en" maxLength={40} value={form[k]?.en ?? ''} placeholder={TERM_DEFAULTS[k]} onChange={(e) => set(k, 'en', e.target.value)} aria-label={`${TERM_DEFAULTS[k]} — English`} /></label>
            <label className="field"><span className="label">العربية</span><input dir="rtl" lang="ar" maxLength={40} value={form[k]?.ar ?? ''} placeholder={AR[TERM_DEFAULTS[k]] ?? ''} onChange={(e) => set(k, 'ar', e.target.value)} aria-label={`${TERM_DEFAULTS[k]} — العربية`} /></label>
          </div>))}
        <span className="muted small">{t('Custom labels are never translated automatically: an empty Arabic field falls back to the product’s own Arabic wording. Changes are recorded in the audit log.')}</span>
      </div>
    </>
  );
}
