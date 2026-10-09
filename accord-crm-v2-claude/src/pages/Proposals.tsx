import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FilePlus2, ClipboardList } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { PageHead, Tabs, Loading, Empty, ErrorNote, UserSelect, Modal, LeadPicker } from '../components/ui';
import { ProposalDialog, ProposalResponseDialog, FormDialog, openFile } from '../components/commercial';
import { useToast } from '../lib/toast';
import { cairoToday, fmtDate } from '../lib/cairo';
import { label, PROPOSAL_STATUS, FORM_STATUS, RESPONSE_OUTCOME, proposalCode } from '../lib/labels';
import type { Proposal, Form } from '../lib/types';

type Tab = 'all' | 'action' | 'awaiting' | 'followup' | 'forms';

export default function Proposals() {
  const { profile, isStaff } = useAuth(); const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get('tab') as Tab) || 'all';
  const [who, setWho] = useState(profile!.id);
  const [pick, setPick] = useState<null | 'proposal' | 'form'>(null);
  const [target, setTarget] = useState<null | { kind: 'proposal' | 'form'; lead: { id: string; name: string } }>(null);
  const [edit, setEdit] = useState<Proposal | null>(null); const [resp, setResp] = useState<Proposal | null>(null); const [editForm, setEditForm] = useState<Form | null>(null);
  const t = cairoToday();

  const props = useQuery({
    queryKey: ['proposals', tab, who, t], enabled: tab !== 'forms',
    queryFn: async () => {
      let b = supabase.from('proposals').select('*, leads(name)').order('created_at', { ascending: false }).limit(200);
      if (who) b = b.eq('owner_id', who);
      if (tab === 'action') b = b.in('status', ['not_started', 'preparing', 'ready', 'revision_requested']);
      if (tab === 'awaiting') b = b.in('status', ['sent', 'under_review']).neq('response_state', 'responded');
      if (tab === 'followup') b = b.in('status', ['sent', 'under_review', 'revision_requested']).lte('next_follow_up_date', t);
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
      <PageHead title="Proposals & forms" sub="Prepare, send and track client responses"
        actions={<><UserSelect value={who} onChange={setWho} includeAll allLabel="Everyone" />{isStaff && <><button className="btn" onClick={() => setPick('form')}><ClipboardList /> Track form</button><button className="btn primary" onClick={() => setPick('proposal')}><FilePlus2 /> New proposal</button></>}</>} />
      <div style={{ marginBottom: 12 }}>
        <Tabs value={tab} onChange={(k) => setSp({ tab: k }, { replace: true })} tabs={[{ key: 'all', label: 'All proposals' }, { key: 'action', label: 'Needs action' }, { key: 'awaiting', label: 'Awaiting response' }, { key: 'followup', label: 'Follow-ups due' }, { key: 'forms', label: 'Information forms' }]} />
      </div>
      <ErrorNote error={props.error ?? forms.error} />
      <div className="card">
        {tab !== 'forms' ? (props.isLoading ? <Loading /> : !props.data?.length ? <Empty>No proposals in this view.</Empty> : (
          <div className="table-wrap"><table className="t" aria-label="Proposals"><thead><tr><th>ID</th><th>Lead</th><th>Title</th><th>Status</th><th className="r">Value</th><th>Sent</th><th>Client response</th><th>Next follow-up</th><th /></tr></thead><tbody>
            {props.data.map((p) => (
              <tr key={p.id}><td className="nowrap">{proposalCode(p.proposal_no)}</td><td><Link to={`/leads/view/?id=${p.lead_id}`}>{p.leads?.name}</Link></td><td>{p.title}</td>
                <td><span className="badge stage">{label(PROPOSAL_STATUS, p.status)}</span></td>
                <td className="r num">{p.value !== null ? `${Number(p.value).toLocaleString()} ${p.currency}` : '—'}</td><td>{fmtDate(p.sent_on)}</td>
                <td>{p.response_state ? label([['awaiting_response', 'Awaiting'], ['responded', 'Responded'], ['no_response_yet', 'No response yet']], p.response_state) : '—'}{p.response_outcome ? <span className="muted small"> · {label(RESPONSE_OUTCOME, p.response_outcome)}</span> : ''}</td>
                <td style={{ color: p.next_follow_up_date && p.next_follow_up_date <= t && ['sent', 'under_review', 'revision_requested'].includes(p.status) ? 'var(--bad)' : undefined }}>{fmtDate(p.next_follow_up_date)}</td>
                <td className="r nowrap">{p.file_path && <button className="btn sm ghost" onClick={() => openFile(p.file_path!).catch((e) => toast(e.message, 'bad'))}>File</button>}
                  {isStaff && <button className="btn sm" onClick={() => setEdit(p)}>Edit</button>}
                  {isStaff && ['sent', 'under_review', 'revision_requested'].includes(p.status) && <button className="btn sm primary" onClick={() => setResp(p)}>Response</button>}</td></tr>))}
          </tbody></table></div>)
        ) : (forms.isLoading ? <Loading /> : !forms.data?.length ? <Empty>No information forms tracked.</Empty> : (
          <div className="table-wrap"><table className="t" aria-label="Information forms"><thead><tr><th>Lead</th><th>Status</th><th>Sent</th><th>Completed</th><th>Notes</th><th /></tr></thead><tbody>
            {forms.data.map((f) => (
              <tr key={f.id}><td><Link to={`/leads/view/?id=${f.lead_id}`}>{f.leads?.name}</Link></td><td><span className={`badge ${f.status === 'completed' ? 'ok' : f.status === 'not_sent' ? 'warn' : 'info'}`}>{label(FORM_STATUS, f.status)}</span></td>
                <td>{fmtDate(f.sent_on)}</td><td>{fmtDate(f.completed_on)}</td><td>{f.notes}</td><td className="r">{isStaff && <button className="btn sm" onClick={() => setEditForm(f)}>Update</button>}</td></tr>))}
          </tbody></table></div>))}
      </div>
      {pick && <Modal narrow title="Which lead?" onClose={() => setPick(null)}><LeadPicker autoFocus onPick={(l) => { setTarget({ kind: pick, lead: { id: l.id, name: l.name } }); setPick(null); }} /></Modal>}
      {target?.kind === 'proposal' && <ProposalDialog leadId={target.lead.id} leadName={target.lead.name} onClose={() => setTarget(null)} />}
      {target?.kind === 'form' && <FormDialog leadId={target.lead.id} leadName={target.lead.name} onClose={() => setTarget(null)} />}
      {edit && <ProposalDialog leadId={edit.lead_id} leadName={edit.leads?.name ?? ''} proposal={edit} onClose={() => setEdit(null)} />}
      {resp && <ProposalResponseDialog proposal={resp} leadName={resp.leads?.name ?? ''} onClose={() => setResp(null)} />}
      {editForm && <FormDialog leadId={editForm.lead_id} leadName={editForm.leads?.name ?? ''} form={editForm} onClose={() => setEditForm(null)} />}
    </>
  );
}
