import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Phone, Pencil, CalendarPlus, ClipboardList, FilePlus2, CalendarClock, Mail, Linkedin, Plus, Trash2, Sparkles,
  PhoneCall, CheckCircle2, Handshake, GitBranch, Thermometer, FileText, Send, Scale, CalendarX, Users, Circle,
} from 'lucide-react';
import { supabase, unwrap } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { useCall } from '../components/CallProvider';
import { PageHead, Loading, Empty, ErrorNote, TempBadge, StageBadge, Tabs, Modal, Field, displayName, Select } from '../components/ui';
import { LeadFormDialog } from '../components/LeadForm';
import { MeetingCard } from '../components/MeetingCard';
import { MeetingFormDialog } from '../components/meetings';
import { FollowUpFormDialog, CompleteFollowUpDialog } from '../components/followups';
import { FormDialog, ProposalDialog, ProposalResponseDialog, FilesPanel, useInvalidateCommercial, openFile } from '../components/commercial';
import { computeMilestones } from '../lib/milestones';
import { addDays, cairoDayStart, cairoToday, fmtDate, fmtDateTime, fmtRelative } from '../lib/cairo';
import { label, OUTCOME_LABEL, MEETING_OUTCOMES, NEXT_STEPS, FORM_STATUS, PROPOSAL_STATUS, STAGES, STAGE_LABEL, TEMPERATURES, TEMP_LABEL, proposalCode, RESPONSE_OUTCOME } from '../lib/labels';
import type { LeadRow, Contact, Meeting, FollowUp, Activity, CallAttempt, Proposal, Form } from '../lib/types';

const ICONS: Record<string, JSX.Element> = {
  call: <PhoneCall />, lead_created: <Plus />, follow_up_created: <CalendarClock />, follow_up_completed: <CheckCircle2 />, follow_up_rescheduled: <CalendarClock />,
  meeting_requested: <Handshake />, meeting_scheduled: <CalendarPlus />, meeting_confirmed: <CheckCircle2 />, meeting_attended: <Users />, meeting_not_attended: <CalendarX />,
  meeting_rescheduled: <CalendarClock />, meeting_cancelled: <CalendarX />, minutes_added: <FileText />, form_required: <ClipboardList />, form_sent: <Send />,
  form_completed: <CheckCircle2 />, form_updated: <ClipboardList />, proposal_prepared: <FilePlus2 />, proposal_sent: <Send />, proposal_status_changed: <FileText />,
  proposal_response: <FileText />, negotiation: <Scale />, pipeline_change: <GitBranch />, temperature_change: <Thermometer />,
};

export default function LeadView() {
  const [sp] = useSearchParams();
  const id = sp.get('id') ?? '';
  const { profile, isAdmin, isStaff } = useAuth();
  const { startCall } = useCall();
  const qc = useQueryClient(); const toast = useToast();
  const [tab, setTab] = useState<'timeline' | 'calls' | 'contacts' | 'meetings' | 'commercial' | 'files'>('timeline');
  const [dlg, setDlg] = useState<null | 'edit' | 'meeting' | 'request' | 'followup' | 'form' | 'proposal'>(null);
  const today = cairoToday();

  const lead = useQuery({
    queryKey: ['lead', id], enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase.from('lead_list_v').select('*').eq('id', id).maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error('Lead not found or you do not have access');
      const extra = await supabase.from('leads').select('website,notes,address').eq('id', id).maybeSingle();
      return { ...(data as LeadRow), ...(extra.data ?? {}) } as LeadRow & { website: string | null; notes: string | null; address: string | null };
    },
  });
  const callsToday = useQuery({
    queryKey: ['lead', id, 'callsToday', today], enabled: Boolean(id),
    queryFn: async () => {
      const { count } = await supabase.from('call_attempts').select('id', { count: 'exact', head: true }).eq('lead_id', id)
        .gte('called_at', cairoDayStart(today).toISOString()).lt('called_at', cairoDayStart(addDays(today, 1)).toISOString());
      return count ?? 0;
    },
  });
  const commercial = useQuery({
    queryKey: ['leadCommercial', id], enabled: Boolean(id),
    queryFn: async () => {
      const [f, p, m] = await Promise.all([
        supabase.from('commercial_forms').select('*').eq('lead_id', id).order('created_at', { ascending: false }),
        supabase.from('proposals').select('*').eq('lead_id', id).order('created_at', { ascending: false }),
        supabase.from('meetings').select('next_step,next_step_detail,scheduled_at').eq('lead_id', id).eq('attendance_status', 'attended').not('next_step', 'is', null).order('scheduled_at', { ascending: false }).limit(1),
      ]);
      if (f.error) throw new Error(f.error.message); if (p.error) throw new Error(p.error.message);
      return { forms: f.data as Form[], proposals: p.data as Proposal[], lastStep: (m.data?.[0] ?? null) as { next_step: string; next_step_detail: string | null } | null };
    },
  });
  const followUps = useQuery({
    queryKey: ['leadFollowUps', id], enabled: Boolean(id),
    queryFn: async () => unwrap(await supabase.from('follow_ups').select('*').eq('lead_id', id).eq('status', 'open').order('due_date')) as FollowUp[],
  });

  if (!id) return <Empty>No lead selected. <Link to="/leads/">Back to leads</Link></Empty>;
  if (lead.isLoading) return <Loading />;
  if (lead.error || !lead.data) return <><ErrorNote error={lead.error} /><Link to="/leads/">← Back to leads</Link></>;
  const l = lead.data;
  const canEdit = isAdmin || (isStaff && (l.owner_id === null || l.owner_id === profile?.id));
  const invalidate = () => { for (const k of [['lead', id], ['leads'], ['activities', id], ['pipeline']]) qc.invalidateQueries({ queryKey: k }); };
  async function setField(patch: Record<string, unknown>, msg: string) {
    try { unwrap(await supabase.from('leads').update(patch).eq('id', id).select('id')); invalidate(); toast(msg, 'ok'); } catch (e) { toast((e as Error).message, 'bad'); }
  }
  const ms = computeMilestones(l);
  const lastProposal = commercial.data?.proposals[0]; const lastForm = commercial.data?.forms[0];

  return (
    <>
      <PageHead
        title={<span className="row">{l.name}{l.external_lead_id && <span className="muted small">#{l.external_lead_id}</span>}</span>}
        sub={<span className="row"><TempBadge v={l.temperature} /><StageBadge v={l.pipeline_stage} />{l.owner_name && <span className="muted">Owner: {l.owner_name}</span>}{l.source === 'google_sheet' && <span className="badge">Imported</span>}</span>}
        actions={<>
          {isStaff && <button className="btn primary" onClick={() => startCall({ id, name: l.name })} data-testid="profile-call"><Phone /> Call</button>}
          {isStaff && <button className="btn" onClick={() => setDlg('followup')}><CalendarClock /> Follow-up</button>}
          {isStaff && <button className="btn" onClick={() => setDlg('meeting')}><CalendarPlus /> Meeting</button>}
          {canEdit && <button className="btn" onClick={() => setDlg('edit')}><Pencil /> Edit</button>}
        </>} />

      {l.suggested_stage && canEdit && (
        <div className="notice warn row spread" style={{ marginBottom: 12 }} data-testid="stage-suggestion">
          <span><Sparkles size={14} /> Based on recorded activity, consider moving this lead to <b>{STAGE_LABEL[l.suggested_stage]}</b>. Nothing changes until you confirm.</span>
          <button className="btn sm primary" onClick={() => { if (confirm(`Move ${l.name} to ${STAGE_LABEL[l.suggested_stage!]}?`)) setField({ pipeline_stage: l.suggested_stage }, 'Pipeline stage updated'); }}>Apply</button>
        </div>
      )}

      <section aria-label="Commercial milestones" className="milestones" style={{ marginBottom: 14 }}>
        {ms.map((m) => <div key={m.key} className={`ms ${m.state}`}><b>{m.label}</b><span>{m.text}</span></div>)}
      </section>

      <div className="grid cols-3" style={{ marginBottom: 14 }}>
        <div className="card card-pad col">
          <h3>Company & contact</h3>
          <dl className="kv">
            <dt>Primary contact</dt><dd>{l.primary_contact ?? '—'}</dd>
            <dt>Contacts on file</dt><dd>{l.contacts_count ?? 0}</dd>
            <dt>Temperature</dt><dd>{canEdit ? <Select value={l.temperature} onChange={(v) => setField({ temperature: v }, 'Temperature updated')} options={TEMPERATURES.map((t) => [t, TEMP_LABEL[t]])} /> : <TempBadge v={l.temperature} />}</dd>
            <dt>Pipeline stage</dt><dd>{canEdit ? <Select value={l.pipeline_stage} onChange={(v) => setField({ pipeline_stage: v }, 'Pipeline stage updated')} options={STAGES.map((t) => [t, STAGE_LABEL[t]])} /> : <StageBadge v={l.pipeline_stage} />}</dd>
          </dl>
        </div>
        <div className="card card-pad col">
          <h3>Calls</h3>
          <dl className="kv">
            <dt>Calls today</dt><dd data-testid="lead-calls-today">{callsToday.data ?? '…'}</dd>
            <dt>Total calls</dt><dd data-testid="lead-total-calls">{l.total_calls ?? 0} <span className="muted small">({l.responded_calls ?? 0} responded)</span></dd>
            <dt>Last call</dt><dd>{l.last_call_at ? `${fmtDateTime(l.last_call_at)} · ${OUTCOME_LABEL[l.last_call_outcome ?? ''] ?? ''}` : 'Never'}</dd>
            <dt>Next follow-up</dt><dd>{l.next_follow_up_date ? <span style={{ color: l.next_follow_up_date < today ? 'var(--bad)' : undefined }}>{fmtDate(l.next_follow_up_date)}</span> : '—'}</dd>
          </dl>
        </div>
        <div className="card card-pad col">
          <h3>Meetings & commercial</h3>
          <dl className="kv">
            <dt>Next meeting</dt><dd>{l.next_meeting_at ? <>{fmtDateTime(l.next_meeting_at)} <span className={`badge ${l.next_meeting_confirmation === 'confirmed' ? 'ok' : 'warn'}`}>{l.next_meeting_confirmation}</span></> : '—'}</dd>
            <dt>Last meeting outcome</dt><dd>{label(MEETING_OUTCOMES, l.last_meeting_outcome)}</dd>
            <dt>Information form</dt><dd>{label(FORM_STATUS, l.form_status)}</dd>
            <dt>Proposal</dt><dd>{label(PROPOSAL_STATUS, l.proposal_status)}{l.proposal_response ? <span className="muted"> · {label([...RESPONSE_OUTCOME, ['awaiting_response', 'Awaiting response'], ['no_response_yet', 'No response yet']], l.proposal_response)}</span> : ''}</dd>
            <dt>Next commercial step</dt><dd>{commercial.data?.lastStep ? `${label(NEXT_STEPS, commercial.data.lastStep.next_step)}${commercial.data.lastStep.next_step_detail ? ` — ${commercial.data.lastStep.next_step_detail}` : ''}` : '—'}</dd>
          </dl>
        </div>
      </div>

      {(followUps.data?.length ?? 0) > 0 && <FollowUpStrip items={followUps.data!} leadName={l.name} canAct={isStaff} />}

      <div style={{ margin: '14px 0 10px' }}>
        <Tabs value={tab} onChange={setTab} tabs={[
          { key: 'timeline', label: 'Timeline' }, { key: 'calls', label: 'Calls', count: l.total_calls ?? 0 }, { key: 'contacts', label: 'Contacts', count: l.contacts_count ?? 0 },
          { key: 'meetings', label: 'Meetings', count: l.meetings_total ?? 0 }, { key: 'commercial', label: 'Forms & Proposals' }, { key: 'files', label: 'Files' }]} />
      </div>

      {tab === 'timeline' && <Timeline leadId={id} />}
      {tab === 'calls' && <CallsTab leadId={id} />}
      {tab === 'contacts' && <ContactsTab leadId={id} canEdit={canEdit} />}
      {tab === 'meetings' && <MeetingsTab leadId={id} leadName={l.name} onNew={() => setDlg('meeting')} canAct={isStaff} />}
      {tab === 'commercial' && (
        <div className="col">
          <div className="row">{isStaff && <><button className="btn" onClick={() => setDlg('form')}><ClipboardList /> Track information form</button><button className="btn" onClick={() => setDlg('proposal')}><FilePlus2 /> New proposal</button></>}</div>
          <CommercialTab leadId={id} leadName={l.name} forms={commercial.data?.forms ?? []} proposals={commercial.data?.proposals ?? []} canAct={isStaff} />
        </div>
      )}
      {tab === 'files' && <FilesPanel leadId={id} />}

      {dlg === 'edit' && <LeadFormDialog lead={l} onClose={() => setDlg(null)} />}
      {dlg === 'meeting' && <MeetingFormDialog leadId={id} leadName={l.name} mode="scheduled" onClose={() => setDlg(null)} />}
      {dlg === 'followup' && <FollowUpFormDialog leadId={id} leadName={l.name} onClose={() => setDlg(null)} />}
      {dlg === 'form' && <FormDialog leadId={id} leadName={l.name} onClose={() => setDlg(null)} />}
      {dlg === 'proposal' && <ProposalDialog leadId={id} leadName={l.name} onClose={() => setDlg(null)} />}
      {l.notes && <div className="card card-pad" style={{ marginTop: 14 }}><h3>Notes</h3><div className="pre">{l.notes}</div></div>}
      {Object.keys(l.legacy ?? {}).length > 0 && <LegacyBox legacy={l.legacy} />}
      {lastProposal || lastForm ? null : null}
    </>
  );
}

function LegacyBox({ legacy }: { legacy: Record<string, unknown> }) {
  const rows = Object.entries(legacy).filter(([, v]) => v !== null && v !== '' && !(Array.isArray(v) && v.length === 0));
  if (!rows.length) return null;
  return (
    <details className="card card-pad" style={{ marginTop: 14 }}>
      <summary><b>Legacy sheet data</b> <span className="muted small">(imported from Accord New Data — reference only)</span></summary>
      <dl className="kv" style={{ marginTop: 8 }}>{rows.map(([k, v]) => <><dt key={k}>{k.replace(/_/g, ' ')}</dt><dd key={k + 'v'}>{Array.isArray(v) ? v.join(' · ') : String(v)}</dd></>)}</dl>
    </details>
  );
}

function FollowUpStrip({ items, leadName, canAct }: { items: FollowUp[]; leadName: string; canAct: boolean }) {
  const [complete, setComplete] = useState<FollowUp | null>(null); const [resched, setResched] = useState<FollowUp | null>(null);
  const today = cairoToday();
  return (
    <div className="card card-pad col" aria-label="Open follow-ups">
      <h3>Open follow-ups</h3>
      {items.map((f) => (
        <div key={f.id} className="row spread">
          <span><b style={{ color: f.due_date < today ? 'var(--bad)' : undefined }}>{fmtDate(f.due_date)}</b>{f.due_time ? ` ${f.due_time.slice(0, 5)}` : ''} <span className="muted">{f.notes ?? ''}</span> <span className="badge">{f.origin.replace('_', ' ')}</span></span>
          {canAct && <span className="row"><button className="btn sm" onClick={() => setComplete(f)}>Complete</button><button className="btn sm ghost" onClick={() => setResched(f)}>Reschedule</button></span>}
        </div>
      ))}
      {complete && <CompleteFollowUpDialog fu={complete} leadName={leadName} onClose={() => setComplete(null)} />}
      {resched && <FollowUpFormDialog leadId={resched.lead_id} leadName={leadName} editing={resched} onClose={() => setResched(null)} />}
    </div>
  );
}

function Timeline({ leadId }: { leadId: string }) {
  const q = useInfiniteQuery({
    queryKey: ['activities', leadId], initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase.from('activities').select('*, profiles(full_name)').eq('lead_id', leadId)
        .order('occurred_at', { ascending: false }).order('id', { ascending: false }).range(pageParam, pageParam + 29);
      if (error) throw new Error(error.message);
      return data as unknown as Activity[];
    },
    getNextPageParam: (last, all) => (last.length === 30 ? all.length * 30 : undefined),
  });
  if (q.isLoading) return <Loading />;
  const rows = q.data?.pages.flat() ?? [];
  if (!rows.length) return <div className="card"><Empty>No activity recorded yet.</Empty></div>;
  return (
    <div className="card card-pad">
      <ul className="timeline">
        {rows.map((a) => (
          <li key={a.id} className="tl" data-type={a.type}>
            <div className="dot">{ICONS[a.type] ?? <Circle />}</div>
            <div><div><b>{a.summary ?? a.type}</b></div><div className="muted small">{fmtDateTime(a.occurred_at)} · {fmtRelative(a.occurred_at)}{a.profiles?.full_name ? ` · ${a.profiles.full_name}` : ''}</div></div>
          </li>
        ))}
      </ul>
      {q.hasNextPage && <button className="btn" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>{q.isFetchingNextPage ? 'Loading…' : 'Load older events'}</button>}
    </div>
  );
}

function CallsTab({ leadId }: { leadId: string }) {
  const { profile, isAdmin } = useAuth(); const qc = useQueryClient(); const toast = useToast();
  const [edit, setEdit] = useState<CallAttempt | null>(null);
  const q = useInfiniteQuery({
    queryKey: ['leadCalls', leadId], initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase.from('call_attempts').select('*, profiles(full_name)').eq('lead_id', leadId).order('called_at', { ascending: false }).range(pageParam, pageParam + 24);
      if (error) throw new Error(error.message); return data as unknown as CallAttempt[];
    },
    getNextPageParam: (last, all) => (last.length === 25 ? all.length * 25 : undefined),
  });
  const today = cairoToday();
  const refresh = () => { for (const k of [['leadCalls', leadId], ['lead', leadId], ['leads'], ['callMetrics'], ['myCallsToday']]) qc.invalidateQueries({ queryKey: k }); };
  async function del(c: CallAttempt) {
    if (!confirm('Delete this call attempt? (audited)')) return;
    const { error } = await supabase.from('call_attempts').delete().eq('id', c.id); if (error) toast(error.message, 'bad'); else { refresh(); toast('Call deleted', 'ok'); }
  }
  if (q.isLoading) return <Loading />;
  const rows = q.data?.pages.flat() ?? [];
  return (
    <div className="card">
      {!rows.length ? <Empty>No calls logged for this lead.</Empty> : (
        <div className="table-wrap"><table className="t"><thead><tr><th>When (Cairo)</th><th>Outcome</th><th>By</th><th>Note</th><th /></tr></thead><tbody>
          {rows.map((c) => (
            <tr key={c.id}><td className="nowrap">{fmtDateTime(c.called_at)}</td>
              <td><span className={`badge ${c.outcome === 'responded' ? 'ok' : 'bad'}`}>{OUTCOME_LABEL[c.outcome] ?? c.outcome}</span>{c.sub_outcome && <span className="muted small"> · {c.sub_outcome.replace(/_/g, ' ')}</span>}</td>
              <td>{c.profiles?.full_name}</td><td>{c.notes}</td>
              <td className="r">{(isAdmin || (c.user_id === profile?.id && c.called_at.slice(0, 10) >= today)) && <><button className="btn sm ghost" onClick={() => setEdit(c)} aria-label="Edit call"><Pencil /></button><button className="btn sm ghost" onClick={() => del(c)} aria-label="Delete call"><Trash2 /></button></>}</td></tr>
          ))}
        </tbody></table></div>
      )}
      {q.hasNextPage && <div className="card-pad"><button className="btn" onClick={() => q.fetchNextPage()}>Load older calls</button></div>}
      {edit && <EditCall call={edit} onClose={() => { setEdit(null); refresh(); }} />}
    </div>
  );
}

function EditCall({ call, onClose }: { call: CallAttempt; onClose: () => void }) {
  const [outcome, setOutcome] = useState(call.outcome); const [notes, setNotes] = useState(call.notes ?? ''); const [err, setErr] = useState<unknown>(null);
  async function save() {
    try { unwrap(await supabase.from('call_attempts').update({ outcome, notes: notes.trim() || null }).eq('id', call.id).select('id')); onClose(); } catch (e) { setErr(e); }
  }
  return (
    <Modal narrow title="Edit call attempt" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      <ErrorNote error={err} />
      <Field label="Outcome"><Select value={outcome} onChange={setOutcome} options={[['responded', 'Responded'], ['did_not_respond', "Didn't Respond"]]} /></Field>
      <Field label="Note"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <span className="muted small">Edits are recorded in the audit log.</span>
    </Modal>
  );
}

function ContactsTab({ leadId, canEdit }: { leadId: string; canEdit: boolean }) {
  const qc = useQueryClient(); const [edit, setEdit] = useState<Contact | 'new' | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['contacts', leadId], queryFn: async () => unwrap(await supabase.from('contacts').select('*').eq('lead_id', leadId).order('is_primary', { ascending: false }).order('created_at')) as Contact[] });
  if (isLoading) return <Loading />;
  return (
    <div className="col">
      {canEdit && <div><button className="btn" onClick={() => setEdit('new')}><Plus /> Add contact</button></div>}
      {!data?.length && <div className="card"><Empty>No contacts yet.</Empty></div>}
      <div className="grid cols-2">
        {data?.map((c) => (
          <div key={c.id} className="card card-pad col">
            <div className="row spread"><b>{c.full_name || 'Company line (general)'}</b>{c.is_primary && <span className="badge info">Primary</span>}</div>
            {c.job_title && <span className="muted">{c.job_title}</span>}
            {c.emails.map((e) => <a key={e} className="row small" href={`mailto:${e}`}><Mail size={14} /> {e}</a>)}
            {c.phones.map((p) => <a key={p} className="row small" href={`tel:${p}`}><Phone size={14} /> {p}</a>)}
            {c.linkedin.map((u) => <a key={u} className="row small" href={u} target="_blank" rel="noopener noreferrer"><Linkedin size={14} /> {u.replace('https://www.linkedin.com/', '')}</a>)}
            {canEdit && <div><button className="btn sm" onClick={() => setEdit(c)}><Pencil /> Edit</button></div>}
          </div>
        ))}
      </div>
      {edit && <ContactDialog leadId={leadId} contact={edit === 'new' ? undefined : edit} onClose={() => { setEdit(null); qc.invalidateQueries({ queryKey: ['contacts', leadId] }); qc.invalidateQueries({ queryKey: ['lead', leadId] }); qc.invalidateQueries({ queryKey: ['leads'] }); }} />}
    </div>
  );
}
function ContactDialog({ leadId, contact, onClose }: { leadId: string; contact?: Contact; onClose: () => void }) {
  const { isAdmin } = useAuth();
  const [name, setName] = useState(contact?.full_name ?? ''); const [title, setTitle] = useState(contact?.job_title ?? '');
  const [emails, setEmails] = useState(contact?.emails.join(', ') ?? ''); const [phones, setPhones] = useState(contact?.phones.join(', ') ?? '');
  const [li, setLi] = useState(contact?.linkedin.join(', ') ?? ''); const [primary, setPrimary] = useState(contact?.is_primary ?? false); const [err, setErr] = useState<unknown>(null);
  const list = (s: string) => [...new Set(s.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean))];
  async function save() {
    try {
      const row = { full_name: name.trim(), job_title: title.trim() || null, emails: list(emails.toLowerCase()), phones: list(phones), linkedin: list(li), is_primary: primary };
      if (contact) unwrap(await supabase.from('contacts').update(row).eq('id', contact.id).select('id'));
      else unwrap(await supabase.from('contacts').insert({ ...row, lead_id: leadId }).select('id'));
      onClose();
    } catch (e) { setErr(e); }
  }
  async function del() { if (!confirm('Delete this contact?')) return; const { error } = await supabase.from('contacts').delete().eq('id', contact!.id); if (error) setErr(error); else onClose(); }
  return (
    <Modal title={contact ? 'Edit contact' : 'Add contact'} onClose={onClose} footer={<>{contact && isAdmin && <button className="btn bad" onClick={del}>Delete</button>}<button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      <ErrorNote error={err} />
      <div className="form-grid"><Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} /></Field><Field label="Job title"><input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Emails (comma separated)" full><input value={emails} onChange={(e) => setEmails(e.target.value)} /></Field>
        <Field label="Phones (comma separated)" full><input value={phones} onChange={(e) => setPhones(e.target.value)} inputMode="tel" /></Field>
        <Field label="LinkedIn URLs" full><input value={li} onChange={(e) => setLi(e.target.value)} /></Field></div>
      <label className="row"><input type="checkbox" checked={primary} onChange={(e) => setPrimary(e.target.checked)} /> Primary contact</label>
    </Modal>
  );
}

function MeetingsTab({ leadId, leadName, onNew, canAct }: { leadId: string; leadName: string; onNew: () => void; canAct: boolean }) {
  const [req, setReq] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['leadMeetings', leadId], queryFn: async () => unwrap(await supabase.from('meetings').select('*, leads(name)').eq('lead_id', leadId).order('scheduled_at', { ascending: false, nullsFirst: true })) as Meeting[] });
  if (isLoading) return <Loading />;
  return (
    <div className="col">
      {canAct && <div className="row"><button className="btn primary" onClick={onNew}><CalendarPlus /> Schedule meeting</button><button className="btn" onClick={() => setReq(true)}><Handshake /> Record meeting request</button></div>}
      {!data?.length ? <div className="card"><Empty>No meetings yet.</Empty></div> : data.map((m) => <MeetingCard key={m.id} m={m} showLead={false} />)}
      {req && <MeetingFormDialog leadId={leadId} leadName={leadName} mode="requested" onClose={() => setReq(false)} />}
    </div>
  );
}

function CommercialTab({ leadId, leadName, forms, proposals, canAct }: { leadId: string; leadName: string; forms: Form[]; proposals: Proposal[]; canAct: boolean }) {
  const [f, setF] = useState<Form | null>(null); const [p, setP] = useState<Proposal | null>(null); const [r, setR] = useState<Proposal | null>(null);
  const inv = useInvalidateCommercial(); const toast = useToast();
  return (
    <div className="grid cols-2">
      <div className="card"><div className="card-head"><h2>Information forms</h2></div>
        {!forms.length ? <Empty>No form tracked.</Empty> : forms.map((x) => (
          <div key={x.id} className="card-pad col" style={{ borderBottom: '1px solid var(--line)' }}>
            <div className="row spread"><span className={`badge ${x.status === 'completed' ? 'ok' : x.status === 'not_sent' ? 'warn' : 'info'}`}>{label(FORM_STATUS, x.status)}</span>
              {canAct && <button className="btn sm" onClick={() => setF(x)}>Update</button>}</div>
            <span className="muted small">{x.sent_on ? `Sent ${fmtDate(x.sent_on)}` : 'Not sent'}{x.completed_on ? ` · Completed ${fmtDate(x.completed_on)}` : ''}</span>
            {x.link && <a href={x.link} target="_blank" rel="noopener noreferrer" className="small">{x.link}</a>}{x.notes && <span className="small">{x.notes}</span>}
          </div>))}
      </div>
      <div className="card"><div className="card-head"><h2>Proposals</h2></div>
        {!proposals.length ? <Empty>No proposals.</Empty> : proposals.map((x) => (
          <div key={x.id} className="card-pad col" style={{ borderBottom: '1px solid var(--line)' }}>
            <div className="row spread"><span><b>{proposalCode(x.proposal_no)}</b> · {x.title}</span><span className="badge stage">{label(PROPOSAL_STATUS, x.status)}</span></div>
            <span className="muted small">{x.value !== null ? `${Number(x.value).toLocaleString()} ${x.currency}` : 'Value n/a'} · {x.sent_on ? `Sent ${fmtDate(x.sent_on)}` : 'Not sent'}{x.response_state ? ` · ${label([['awaiting_response', 'Awaiting response'], ['responded', 'Responded'], ['no_response_yet', 'No response yet']], x.response_state)}` : ''}{x.response_outcome ? ` (${label(RESPONSE_OUTCOME, x.response_outcome)})` : ''}</span>
            {x.next_follow_up_date && <span className="small">Next follow-up {fmtDate(x.next_follow_up_date)}</span>}
            <div className="row">
              {x.file_path && <button className="btn sm" onClick={() => openFile(x.file_path!).catch((e) => toast(e.message, 'bad'))}>Open file</button>}
              {canAct && <button className="btn sm" onClick={() => setP(x)}>Edit</button>}
              {canAct && ['sent', 'under_review', 'revision_requested'].includes(x.status) && <button className="btn sm primary" onClick={() => setR(x)}>Record response</button>}
              {canAct && x.status === 'sent' && x.response_state !== 'no_response_yet' && x.response_state !== 'responded' && <button className="btn sm ghost" onClick={async () => { const { error } = await supabase.from('proposals').update({ response_state: 'no_response_yet' }).eq('id', x.id); if (error) toast(error.message, 'bad'); else inv(leadId); }}>No response yet</button>}
            </div>
          </div>))}
      </div>
      {f && <FormDialog leadId={leadId} leadName={leadName} form={f} onClose={() => setF(null)} />}
      {p && <ProposalDialog leadId={leadId} leadName={leadName} proposal={p} onClose={() => setP(null)} />}
      {r && <ProposalResponseDialog proposal={r} leadName={leadName} onClose={() => setR(null)} />}
    </div>
  );
}

export { displayName };
