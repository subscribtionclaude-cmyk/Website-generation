import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, Lock, ShieldCheck } from 'lucide-react';
import { supabase, unwrap } from '../../lib/supabase';
import { PageHead, Loading, ErrorNote, Segmented, Switch } from '../../components/ui';
import { useToast } from '../../lib/toast';
import { t } from '../../lib/i18n';
import { ROLE_LABEL } from '../../lib/labels';
import { setPreviewRole } from '../../lib/preview';
import { PERM_INFO, SECTION_LABEL, SECTION_ORDER, modeFor, type CatalogRow } from '../../lib/permissionsMeta';

type Role = 'bd_executive' | 'viewer' | 'admin';

export function useCatalog() {
  return useQuery({ queryKey: ['permCatalog'], staleTime: 10 * 60_000, queryFn: async () => unwrap(await supabase.from('permission_catalog').select('*').order('section').order('sort')) as CatalogRow[] });
}
export function useRoleTemplate(role: Role) {
  return useQuery({ queryKey: ['roleTemplate', role], queryFn: async () => unwrap(await supabase.rpc('role_template', { p_role: role })) as unknown as Record<string, boolean> });
}

export default function AdminRoles() {
  const [role, setRole] = useState<Role>('viewer');
  const cat = useCatalog(); const tpl = useRoleTemplate(role);
  const qc = useQueryClient(); const toast = useToast(); const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);

  async function toggle(perm: string, on: boolean) {
    setBusy(perm);
    try {
      const r = unwrap(await supabase.rpc('admin_set_role_permission', { p_role: role, p_perm: perm, p_allowed: on })) as unknown as { also_disabled: string[] };
      toast(r.also_disabled?.length ? t('Saved — dependent permissions also turned off: {list}', { list: r.also_disabled.map((p) => t(PERM_INFO[p]?.label ?? p)).join(', ') }) : t('Permission saved'), 'ok');
      await Promise.all([qc.invalidateQueries({ queryKey: ['roleTemplate'] }), qc.invalidateQueries({ queryKey: ['perms'] }), qc.invalidateQueries({ queryKey: ['userPerms'] })]);
    } catch (e) { toast(t((e as Error).message), 'bad'); } finally { setBusy(null); }
  }
  function preview(r: 'bd_executive' | 'viewer') { setPreviewRole(r); navigate(r === 'viewer' ? '/management/' : '/dashboard/'); }

  const v = tpl.data ?? {};
  const individual = Boolean(v['perf.individual']);
  return (
    <>
      <PageHead title={t('Roles & Permissions')} sub={t('What each role can view, export and access. These rules are enforced by the database — not just hidden in the interface.')}
        actions={role !== 'admin' && <button className="btn" onClick={() => preview(role)} data-testid="preview-role"><Eye /> {t('Preview as {role}', { role: ROLE_LABEL[role] })}</button>} />
      <div className="row" style={{ marginBottom: 14 }}>
        <Segmented<Role> label={t('Role')} value={role} onChange={setRole} options={[
          { key: 'viewer', label: ROLE_LABEL.viewer }, { key: 'bd_executive', label: ROLE_LABEL.bd_executive }, { key: 'admin', label: ROLE_LABEL.admin, icon: <Lock /> }]} />
      </div>
      <ErrorNote error={cat.error || tpl.error} />
      {role === 'admin' && <div className="notice" role="note"><ShieldCheck size={16} /> {t('Administrators always have every permission. This is protected so the business can never be locked out, and it cannot be changed.')}</div>}
      {role === 'viewer' && tpl.data && (
        <section className="card card-pad col" style={{ marginBottom: 14 }} aria-label={t('Performance visibility')} data-testid="visibility-mode">
          <h2>{t('Performance visibility')}</h2>
          <Segmented<'department' | 'individual'> label={t('Performance visibility')} value={individual ? 'individual' : 'department'}
            onChange={(m) => toggle('perf.individual', m === 'individual')}
            options={[{ key: 'department', label: t('Department only') }, { key: 'individual', label: t('Individual breakdown') }]} />
          <span className="muted small">{individual
            ? t('Viewers see per-person aggregate KPIs. Names and individual targets are separate switches below. Notes, minutes and contact details are never included.')
            : t('Viewers see sales-department totals and trends only. The server does not send any employee-level figures or names.')}</span>
        </section>)}
      {cat.isLoading || tpl.isLoading ? <Loading /> : cat.data && (
        <div className="grid cols-2" style={{ alignItems: 'start' }}>
          {SECTION_ORDER.map((sec) => {
            const rows = cat.data!.filter((c) => c.section === sec);
            if (!rows.length) return null;
            return (
              <section key={sec} className="card card-pad col perm-section" aria-label={t(SECTION_LABEL[sec])} data-testid={`perm-section-${sec}`}>
                <h2>{t(SECTION_LABEL[sec])}</h2>
                {sec === 'data' && role === 'viewer' && <div className="muted small" data-testid="viewer-raw-locked">{t('A Management Viewer never receives raw CRM records, notes, meeting minutes or contact details — only department and employee aggregates. This is a fixed privacy rule.')}</div>}
                {rows.map((c) => {
                  const mode = modeFor(c, role); const on = Boolean(v[c.perm]);
                  const parentOff = c.depends_on ? !v[c.depends_on] : false;
                  const locked = mode !== 'config';
                  return (
                    <div key={c.perm} className="perm-row" data-testid={`perm-${c.perm}`}>
                      <div className="grow" style={{ minWidth: 0 }}>
                        <b>{t(PERM_INFO[c.perm]?.label ?? c.perm)}</b>
                        <div className="muted small">{t(PERM_INFO[c.perm]?.desc ?? '')}</div>
                        {!locked && parentOff && <div className="small warn-text">{t('Requires “{p}”', { p: t(PERM_INFO[c.depends_on!]?.label ?? c.depends_on!) })}</div>}
                      </div>
                      {locked
                        ? <span className={`badge ${mode === 'on' ? 'ok' : ''}`} title={t('Fixed security rule')}><Lock size={12} /> {mode === 'on' ? t('Always') : c.section === 'admin' || c.perm === 'export.full' ? t('Admin only') : c.section === 'data' ? t('Aggregates only') : t('Not available')}</span>
                        : <Switch checked={on} disabled={busy !== null || (!on && parentOff)} onChange={(x) => toggle(c.perm, x)} label={t(PERM_INFO[c.perm]?.label ?? c.perm)} />}
                    </div>);
                })}
              </section>);
          })}
        </div>)}
      <p className="muted small" style={{ marginTop: 14 }}>{t('Order of precedence: protected administrator rules → a user’s explicit override → the role template → otherwise denied. Per-user overrides are managed from Users & Access → Manage permissions. Every change is written to the audit log.')}</p>
    </>
  );
}
