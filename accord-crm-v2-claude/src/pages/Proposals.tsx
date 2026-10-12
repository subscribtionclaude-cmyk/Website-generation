import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FilePlus2, ClipboardList } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { PageHead, Tabs, Loading, Empty, ErrorNote, UserSelect, Modal, LeadPicker } from '../components/ui';
import { Num, MixBar, Panel, stagger } from '../components/viz';
import { ProposalDialog, ProposalResponseDialog, FormDialog, openFile } from '../components/commercial';
import { useToast } from '../lib/toast';
import { cairoToday, fmtDate } from '../lib/cairo';
import { label, PROPOSAL_STATUS, FORM_STATUS, RESPONSE_OUTCOME, proposalCode } from '../lib/labels';
import type { Proposal, Form } from '../lib/types';
import { t } from '../lib/i18n';

type Tab = 'all' | 'action' | 'awaiting' | 'followup' | 'forms';

export default function Proposals() {
  const { profile, isStaff } = useAuth(); const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get('tab') as Tab) || 'all';
  const [who, setWho] = useState(profile!.id);
  const [pick, setPick] = useState<null | 'proposal' | 'form'>(null);
  const [target, setTarget] = useState<null | { kind: 'proposal' | 'form'; lead: { id: string; name: string } }>(null);
  const [edit, setEdit] = useState<Proposal | null>(null); const [resp, setResp] = useState<Proposal | null>(null); const [editForm, setEditForm] = useState<Form | null>(null);
  const td = cairoToday();

  const props = useQuery({
    queryKey: ['proposals', tab, who, td], enabled: tab !== 'forms',
    queryFn: async () => {
      let b = supabase.from('proposals').select('*, leads(name)').order('created_at', { ascending: false }).limit(200);
      if (who) b = b.eq('owner_id', who);
      if (tab === 'action') b = b.in('status', ['not_started', 'preparing', 'ready', 'revision_requested']);
      if (tab === 'awaiting') b = b.in('status', ['sent', 'under_review']).neq('response_state', 'responded');
      if (tab === 'followup') b = b.in('status', ['sent', 'under_review', 'revision_requested']).lte('next_follow_up_date', td);
      const { data, error } = await b; if (error) throw new Error(error.message); return data as unknown as Proposal[];
    },
  });
  const forms = useQuery({
    queryKey: ['forms', 'list', who], enabled: tab === 'forms',
    queryFn: async () => {
      let b = supabase.from('commercial_forms').select('*, leads(name)').order('created_at', { ascending: false }).limit(200);
      if (who) b = b.eq('owner_id', who);
      const { data, error } = await b; if (error) throw new Error(error.message); return data as unknown as Form[];
    },
  });

  return (
    <>
      <PageHead title={t('Proposals & forms')} sub={t('Prepare, send and track client responses')}
        actions={<><UserSelect value={who} onChange={setWho} includeAll allLabel={t('Everyone')} />{isStaff && <><button className="btn" onClick={() => setPick('form')}><ClipboardList /> {t('Track form')}</button><button className="btn primary" onClick={() => setPick('proposal')}><FilePlus2 /> {t('New proposal')}</button></>}</>} />
      {tab === 'all' && props.data && props.data.length > 0 && <ProposalSummary rows={props.data} />}
      <div style={{ marginBottom: 12 }}>
        <Tabs value={tab} onChange={(k) => setSp({ tab: k }, { replace: true })} tabs={[{ key: 'all', label: 'All proposals' }, { key: 'action', label: 'Needs action' }, { key: 'awaiting', label: 'Awaiting response' }, { key: 'followup', label: 'Follow-ups due' }, { key: 'forms', label: 'Information forms' }]} />
      </div>
      <ErrorNote error={props.error ?? forms.error} />
      <div className="card">
        {tab !== 'forms' ? (props.isLoading ? <Loading /> : !props.data?.length ? <Empty>{t('No proposals in this view.')}</Empty> : (
          <div className="table-wrap"><table className="t" aria-label={t('Proposals')}><thead><tr><th>{t('ID')}</th><th>{t('Lead')}</th><th>{t('Title')}</th><th>{t('Status')}</th><th className="r">{t('Value')}</th><th>{t('Sent')}</th><th>{t('Client response')}</th><th>{t('Next follow-up')}</th><th /></tr></thead><tbody>
            {props.data.map((p) => (
              <tr key={p.id}><td className="nowrap">{proposalCode(p.proposal_no)}</td><td><Link to={`/leads/view/?id=${p.lead_id}`}>{p.leads?.name}</Link></td><td>{p.title}</td>
                <td><span className={`badge p-${p.status}`}>{label(PROPOSAL_STATUS, p.status)}</span></td>
                <td className="r">{p.value !== null ? <span className="money">{Number(p.value).toLocaleString()}<small>{p.currency}</small></span> : '—'}</td><td>{fmtDate(p.sent_on)}</td>
                <td>{p.response_state ? label([['awaiting_response', 'Awaiting'], ['responded', 'Responded'], ['no_response_yet', 'No response yet']], p.response_state) : '—'}{p.response_outcome ? <span className="muted small"> · {label(RESPONSE_OUTCOME, p.response_outcome)}</span> : ''}</td>
                <td style={{ color: p.next_follow_up_date && p.next_follow_up_date <= td && ['sent', 'under_review', 'revision_requested'].includes(p.status) ? 'var(--bad)' : undefined }}>{fmtDate(p.next_follow_up_date)}</td>
                <td className="r nowrap">{p.file_path && <button className="btn sm ghost" onClick={() => openFile(p.file_path!).catch((e) => toast(e.message, 'bad'))}>{t('File')}</button>}
                  {isStaff && <button className="btn sm" onClick={() => setEdit(p)}>{t('Edit')}</button>}
                  {isStaff && ['sent', 'under_review', 'revision_requested'].includes(p.status) && <button className="btn sm primary" onClick={() => setResp(p)}>{t('Response')}</button>}</td></tr>))}
          </tbody></table></div>)
        ) : (forms.isLoading ? <Loading /> : !forms.data?.length ? <Empty>{t('No information forms tracked.')}</Empty> : (
          <div className="table-wrap"><table className="t" aria-label={t('Information forms')}><thead><tr><th>{t('Lead')}</th><th>{t('Status')}</th><th>{t('Sent')}</th><th>{t('Completed')}</th><th>{t('Notes')}</th><th /></tr></thead><tbody>
            {forms.data.map((f) => (
              <tr key={f.id}><td><Link to={`/leads/view/?id=${f.lead_id}`}>{f.leads?.name}</Link></td><td><span className={`badge ${f.status === 'completed' ? 'ok' : f.status === 'not_sent' ? 'warn' : 'info'}`}>{label(FORM_STATUS, f.status)}</span></td>
                <td>{fmtDate(f.sent_on)}</td><td>{fmtDate(f.completed_on)}</td><td>{f.notes}</td><td className="r">{isStaff && <button className="btn sm" onClick={() => setEditForm(f)}>{t('Update')}</button>}</td></tr>))}
          </tbody></table></div>))}
      </div>
      {pick && <Modal narrow title={t('Which lead?')} onClose={() => setPick(null)}><LeadPicker autoFocus onPick={(l) => { setTarget({ kind: pick, lead: { id: l.id, name: l.name } }); setPick(null); }} /></Modal>}
      {target?.kind === 'proposal' && <ProposalDialog leadId={target.lead.id} leadName={target.lead.name} onClose={() => setTarget(null)} />}
      {target?.kind === 'form' && <FormDialog leadId={target.lead.id} leadName={target.lead.name} onClose={() => setTarget(null)} />}
      {edit && <ProposalDialog leadId={edit.lead_id} leadName={edit.leads?.name ?? ''} proposal={edit} onClose={() => setEdit(null)} />}
      {resp && <ProposalResponseDialog proposal={resp} leadName={resp.leads?.name ?? ''} onClose={() => setResp(null)} />}
      {editForm && <FormDialog leadId={editForm.lead_id} leadName={editForm.leads?.name ?? ''} form={editForm} onClose={() => setEditForm(null)} />}
    </>
  );
}

// Status mix of the proposals in this view — commercial picture first, the table below for the records.
const MIX: [string, string, string][] = [['preparing', 'Preparing', 'var(--viz-4)'], ['sent', 'Sent', 'var(--viz-2)'], ['under_review', 'Under review', 'var(--viz-1)'],
  ['revision_requested', 'Revision requested', 'var(--viz-3)'], ['accepted', 'Accepted', 'var(--ok)'], ['rejected', 'Rejected', 'var(--line-strong)']];
function ProposalSummary({ rows }: { rows: Proposal[] }) {
  const bucket = (s: string) => (['not_started', 'preparing', 'ready'].includes(s) ? 'preparing' : s === 'closed' ? 'rejected' : s);
  const n = (k: string) => rows.filter((r) => bucket(r.status) === k).length;
  const open = rows.filter((r) => ['sent', 'under_review', 'revision_requested'].includes(r.status) && r.value !== null);
  const byCur = new Map<string, number>(); for (const r of open) byCur.set(r.currency, (byCur.get(r.currency) ?? 0) + Number(r.value));
  const won = new Map<string, number>(); for (const r of rows.filter((x) => x.status === 'accepted' && x.value !== null)) won.set(r.currency, (won.get(r.currency) ?? 0) + Number(r.value));
  const fmt = (m: Map<string, number>) => (m.size ? [...m.entries()].map(([c, v], i) => <span key={c} className="money">{i > 0 && ' · '}<Num v={v} /><small>{c}</small></span>) : '—');
  return (
    <div className="cc-grid" style={{ marginBottom: 12 }}>
      <Panel className="s8 reveal" style={stagger(0, 60)} title={t('Proposal status mix')} sub={t('Proposals in this view')}>
        <MixBar items={MIX.map(([k, l, c]) => ({ key: k, label: t(l), value: n(k), color: c }))} />
      </Panel>
      <Panel className="s4 reveal" style={stagger(1, 60)} title={t('Commercial value')} sub={t('Sum of proposal values in this view')}>
        <div className="mlist" style={{ ['--n' as string]: 1 }}>
          <div><span>{t('Awaiting decision')}</span><b>{fmt(byCur)}</b></div>
          <div><span>{t('Accepted')}</span><b>{fmt(won)}</b></div>
          <div><span>{t('Awaiting response')}</span><b><Num v={rows.filter((r) => ['sent', 'under_review'].includes(r.status) && r.response_state !== 'responded').length} /></b></div>
        </div>
      </Panel>
    </div>
  );
}
