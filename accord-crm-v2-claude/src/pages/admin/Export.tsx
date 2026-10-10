import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Database, Presentation, Table2, ShieldCheck } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { PageHead, ErrorNote, Empty, Loading } from '../../components/ui';
import { ExportDialog, type ExportKind } from '../../components/ExportDialog';
import { fmtDateTime } from '../../lib/cairo';
import { t } from '../../lib/i18n';

interface AuditRow { id: number; at: string; actor_email: string | null; entity_id: string | null; meta: { format?: string; from?: string | null; to?: string | null } | null }

export default function AdminExport() {
  const [open, setOpen] = useState<null | ExportKind>(null);
  const recent = useQuery({
    queryKey: ['exportAudit'],
    queryFn: async () => {
      const { data, error } = await supabase.from('audit_logs').select('id,at,actor_email,entity_id,meta').eq('entity', 'export').order('at', { ascending: false }).limit(15);
      if (error) throw new Error(error.message); return data as AuditRow[];
    },
  });
  const card = (kind: ExportKind, icon: JSX.Element, title: string, text: string, cta: string) => (
    <section className="card card-pad col" style={{ gap: 10 }}>
      <h2 className="row">{icon} {t(title)}</h2>
      <span className="muted small">{t(text)}</span>
      <div><button className="btn primary" onClick={() => setOpen(kind)} data-testid={`open-export-${kind}`}>{t(cta)}</button></div>
    </section>
  );
  return (
    <>
      <PageHead title="Data export" sub="Excel workbooks and board reports. Exports read with your own access rights and are recorded in the audit log." />
      <div className="grid cols-3" style={{ marginBottom: 18 }}>
        {card('full', <Database size={16} />, 'Full CRM Export', 'One workbook: leads, contacts, calls, follow-ups, meetings, minutes, forms, proposals, pipeline, activities and projects.', 'Export everything')}
        {card('leads', <Table2 size={16} />, 'Individual datasets', 'Export a single dataset with period and filters.', 'Choose dataset')}
        {card('board', <Presentation size={16} />, 'Board Report', 'Daily, weekly or monthly Board Members Report as PDF or Excel (Cairo calendar).', 'Export board report')}
      </div>
      <section className="card" aria-label={t('Recent exports')}>
        <div className="card-head"><h2 className="row"><ShieldCheck size={16} /> {t('Recent exports')}</h2></div>
        <ErrorNote error={recent.error} />
        {recent.isLoading ? <Loading /> : !recent.data?.length ? <Empty>{t('No exports yet.')}</Empty> : (
          <div className="table-wrap"><table className="t" aria-label={t('Recent exports')}><thead><tr><th>{t('When')}</th><th>{t('User')}</th><th>{t('Export type')}</th><th>{t('Format')}</th><th>{t('Period')}</th></tr></thead><tbody>
            {recent.data.map((r) => <tr key={r.id}><td className="nowrap">{fmtDateTime(r.at)}</td><td><bdi className="ltr">{r.actor_email}</bdi></td><td><code>{r.entity_id}</code></td><td>{(r.meta?.format ?? '').toUpperCase()}</td><td className="nowrap">{r.meta?.from ? `${r.meta.from} → ${r.meta.to}` : t('All time')}</td></tr>)}
          </tbody></table></div>)}
      </section>
      {open && <ExportDialog mode="admin" initial={open} onClose={() => setOpen(null)} />}
    </>
  );
}
