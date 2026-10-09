import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Paperclip, Download, Trash2, Upload } from 'lucide-react';
import { supabase, unwrap } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { Modal, Field, Select, ErrorNote, UserSelect, Loading, Empty } from './ui';
import { FORM_STATUS, PROPOSAL_STATUS, RESPONSE_OUTCOME, MEETING_TYPES, CONFIRMATION } from '../lib/labels';
import { cairoToday, fmtDate, fromLocalInput, addDays } from '../lib/cairo';
import type { Form, Proposal } from '../lib/types';

export function useInvalidateCommercial() {
  const qc = useQueryClient();
  return (leadId?: string) => {
    for (const k of [['proposals'], ['forms'], ['leads'], ['dashboard'], ['meetings'], ['followups']]) qc.invalidateQueries({ queryKey: k });
    if (leadId) for (const k of [['lead', leadId], ['activities', leadId], ['leadCommercial', leadId], ['leadFiles', leadId]]) qc.invalidateQueries({ queryKey: k });
  };
}

const safeName = (n: string) => n.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80);

export async function uploadFile(leadId: string, kind: string, file: File, entityType: 'lead' | 'meeting' | 'proposal' | 'form', entityId: string | null, uploader: string): Promise<string> {
  const path = `${leadId}/${kind}/${crypto.randomUUID()}-${safeName(file.name)}`;
  const up = await supabase.storage.from('crm-files').upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (up.error) throw new Error(up.error.message);
  const { error } = await supabase.from('attachments').insert({ lead_id: leadId, entity_type: entityType, entity_id: entityId, path, file_name: file.name, mime_type: file.type || null, size_bytes: file.size, uploaded_by: uploader });
  if (error) { await supabase.storage.from('crm-files').remove([path]); throw new Error(error.message); }
  return path;
}
export async function openFile(path: string) {
  const { data, error } = await supabase.storage.from('crm-files').createSignedUrl(path, 120);
  if (error || !data) throw new Error(error?.message ?? 'Could not open file');
  window.open(data.signedUrl, '_blank', 'noopener');
}

export function FormDialog({ leadId, leadName, form, meetingId, onClose }: { leadId: string; leadName: string; form?: Form; meetingId?: string | null; onClose: () => void }) {
  const { profile } = useAuth(); const toast = useToast(); const inv = useInvalidateCommercial();
  const [status, setStatus] = useState(form?.status ?? 'not_sent');
  const [sentOn, setSentOn] = useState(form?.sent_on ?? '');
  const [doneOn, setDoneOn] = useState(form?.completed_on ?? '');
  const [link, setLink] = useState(form?.link ?? '');
  const [notes, setNotes] = useState(form?.notes ?? '');
  const [evidence, setEvidence] = useState(form?.status === 'completed');
  const [owner, setOwner] = useState(form?.owner_id ?? profile!.id);
  const [err, setErr] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const needSent = ['sent', 'partially_completed', 'completed'].includes(status);

  async function save() {
    setErr(null);
    if (needSent && !sentOn) { setErr(new Error('Enter the date the form was sent')); return; }
    if (status === 'completed' && !doneOn) { setErr(new Error('Enter the date the client completed the form')); return; }
    if (status === 'completed' && !evidence) { setErr(new Error('Confirm the client actually returned the completed form')); return; }
    setBusy(true);
    try {
      const row = { status, required: status !== 'not_required', sent_on: needSent ? sentOn : null, completed_on: status === 'completed' ? doneOn : null, link: link.trim() || null, notes: notes.trim() || null, owner_id: owner };
      if (form) unwrap(await supabase.from('commercial_forms').update(row).eq('id', form.id).select('id'));
      else unwrap(await supabase.from('commercial_forms').insert({ ...row, lead_id: leadId, meeting_id: meetingId ?? null, created_by: profile!.id }).select('id'));
      inv(leadId); toast('Form saved', 'ok'); onClose();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return (
    <Modal title={`${form ? 'Update' : 'Track'} information form · ${leadName}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>Save</button></>}>
      <ErrorNote error={err} />
      <div className="form-grid">
        <Field label="Status" full><Select value={status} onChange={setStatus} options={FORM_STATUS} /></Field>
        {needSent && <Field label="Date sent"><input type="date" max={cairoToday()} value={sentOn} onChange={(e) => setSentOn(e.target.value)} /></Field>}
        {status === 'completed' && <Field label="Date completed"><input type="date" max={cairoToday()} value={doneOn} onChange={(e) => setDoneOn(e.target.value)} /></Field>}
        <Field label="Form link" full><input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" /></Field>
        <Field label="Owner"><UserSelect value={owner} onChange={setOwner} /></Field>
        <Field label="Notes" full><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      {status === 'completed' && <label className="row"><input type="checkbox" checked={evidence} onChange={(e) => setEvidence(e.target.checked)} /> I confirm the client returned the completed form.</label>}
      <span className="muted small">Dates are never filled in automatically — only record what actually happened.</span>
    </Modal>
  );
}

export function ProposalDialog({ leadId, leadName, proposal, onClose, meetingId }: { leadId: string; leadName: string; proposal?: Proposal; onClose: () => void; meetingId?: string | null }) {
  const { profile } = useAuth(); const toast = useToast(); const inv = useInvalidateCommercial();
  const [title, setTitle] = useState(proposal?.title ?? 'Facility Management Proposal');
  const [status, setStatus] = useState(proposal?.status ?? 'preparing');
  const [value, setValue] = useState(proposal?.value?.toString() ?? '');
  const [currency, setCurrency] = useState(proposal?.currency ?? 'EGP');
  const [preparedOn, setPreparedOn] = useState(proposal?.prepared_on ?? '');
  const [sentOn, setSentOn] = useState(proposal?.sent_on ?? '');
  const [nextFu, setNextFu] = useState(proposal?.next_follow_up_date ?? '');
  const [notes, setNotes] = useState(proposal?.notes ?? '');
  const [owner, setOwner] = useState(proposal?.owner_id ?? profile!.id);
  const [formId, setFormId] = useState(proposal?.form_id ?? '');
  const [err, setErr] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { data: forms } = useQuery({ queryKey: ['forms', 'lead', leadId], queryFn: async () => unwrap(await supabase.from('commercial_forms').select('id,status,created_at').eq('lead_id', leadId).order('created_at', { ascending: false })) as { id: string; status: string; created_at: string }[] });
  const needSent = ['sent', 'under_review'].includes(status);

  async function save() {
    setErr(null);
    if (!title.trim()) { setErr(new Error('Title is required')); return; }
    if (needSent && !sentOn) { setErr(new Error('Enter the date the proposal was sent')); return; }
    setBusy(true);
    try {
      const row: Record<string, unknown> = {
        title: title.trim(), status, value: value === '' ? null : Number(value), currency, prepared_on: preparedOn || null, sent_on: sentOn || null,
        next_follow_up_date: nextFu || null, notes: notes.trim() || null, owner_id: owner, form_id: formId || null,
      };
      if (status === 'sent' && !proposal?.response_state) row.response_state = 'awaiting_response';
      let id = proposal?.id;
      if (proposal) unwrap(await supabase.from('proposals').update(row).eq('id', proposal.id).select('id'));
      else id = (unwrap(await supabase.from('proposals').insert({ ...row, lead_id: leadId, meeting_id: meetingId ?? null, created_by: profile!.id }).select('id').single()) as { id: string }).id;
      const f = fileRef.current?.files?.[0];
      if (f && id) {
        const path = await uploadFile(leadId, 'proposal', f, 'proposal', id, profile!.id);
        unwrap(await supabase.from('proposals').update({ file_path: path }).eq('id', id).select('id'));
      }
      inv(leadId); toast('Proposal saved', 'ok'); onClose();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return (
    <Modal wide title={`${proposal ? 'Edit' : 'New'} proposal · ${leadName}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>Save</button></>}>
      <ErrorNote error={err} />
      <div className="form-grid">
        <Field label="Title" full><input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Status"><Select value={status} onChange={setStatus} options={PROPOSAL_STATUS} /></Field>
        <Field label="Owner"><UserSelect value={owner} onChange={setOwner} /></Field>
        <Field label="Value"><input type="number" min="0" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} /></Field>
        <Field label="Currency"><input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))} /></Field>
        <Field label="Prepared date"><input type="date" value={preparedOn} onChange={(e) => setPreparedOn(e.target.value)} /></Field>
        {needSent && <Field label="Sent date"><input type="date" max={cairoToday()} value={sentOn} onChange={(e) => setSentOn(e.target.value)} /></Field>}
        <Field label="Next follow-up"><input type="date" value={nextFu} onChange={(e) => setNextFu(e.target.value)} /></Field>
        <Field label="Linked information form"><select value={formId} onChange={(e) => setFormId(e.target.value)}><option value="">— none —</option>{(forms ?? []).map((f) => <option key={f.id} value={f.id}>{f.status.replace(/_/g, ' ')} · {fmtDate(f.created_at)}</option>)}</select></Field>
        <Field label={proposal?.file_path ? 'Replace proposal file' : 'Proposal file'} full><input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,image/*" /></Field>
        <Field label="Notes" full><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

export function ProposalResponseDialog({ proposal, leadName, onClose }: { proposal: Proposal; leadName: string; onClose: () => void }) {
  const toast = useToast(); const inv = useInvalidateCommercial();
  const [outcome, setOutcome] = useState('');
  const [on, setOn] = useState(cairoToday());
  const [notes, setNotes] = useState('');
  const [fu, setFu] = useState('');
  const [meet, setMeet] = useState(false);
  const [mAt, setMAt] = useState(''); const [mWith, setMWith] = useState(''); const [mType, setMType] = useState('physical'); const [mConf, setMConf] = useState('unconfirmed');
  const [err, setErr] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  async function save() {
    setErr(null);
    if (!outcome) { setErr(new Error('Select the client response')); return; }
    if (meet && !mAt) { setErr(new Error('Enter the review meeting date and time')); return; }
    setBusy(true);
    try {
      unwrap(await supabase.rpc('record_proposal_response', {
        p_proposal: proposal.id, p_outcome: outcome, p_response_on: on, p_notes: notes || null, p_follow_up_date: fu || null,
        p_review_meeting: meet ? { scheduled_at: fromLocalInput(mAt), meeting_type: mType, confirmation_status: mConf, meeting_with: mWith || null, purpose: 'Proposal Review Meeting' } : null,
      }));
      inv(proposal.lead_id); toast('Client response recorded', 'ok'); onClose();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return (
    <Modal wide title={`Client response · ${leadName}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>Record response</button></>}>
      <ErrorNote error={err} />
      <div className="form-grid">
        <Field label="Response"><Select value={outcome} onChange={setOutcome} options={RESPONSE_OUTCOME} placeholder="Select…" /></Field>
        <Field label="Date of response"><input type="date" max={cairoToday()} value={on} onChange={(e) => setOn(e.target.value)} /></Field>
        <Field label="Notes" full><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <Field label="Next follow-up"><input type="date" min={cairoToday()} value={fu} onChange={(e) => setFu(e.target.value)} /></Field>
        <div className="row" style={{ alignItems: 'flex-end' }}>{[['3 days', 3], ['1 week', 7]].map(([l, n]) => <button key={l as string} className="chip" onClick={() => setFu(addDays(cairoToday(), n as number))}>{l}</button>)}</div>
      </div>
      <label className="row"><input type="checkbox" checked={meet} onChange={(e) => setMeet(e.target.checked)} /> <b>Another meeting required</b> (creates a Proposal Review Meeting)</label>
      {meet && (
        <div className="card card-pad form-grid">
          <Field label="Date & time (Cairo)"><input type="datetime-local" value={mAt} onChange={(e) => setMAt(e.target.value)} /></Field>
          <Field label="Meeting with"><input value={mWith} onChange={(e) => setMWith(e.target.value)} /></Field>
          <Field label="Type"><Select value={mType} onChange={setMType} options={MEETING_TYPES} /></Field>
          <Field label="Confirmation"><Select value={mConf} onChange={setMConf} options={CONFIRMATION} /></Field>
        </div>
      )}
      <span className="muted small">"No response" never means Lost. Accepted / Rejected are only set when you record that response.</span>
    </Modal>
  );
}

export function FilesPanel({ leadId }: { leadId: string }) {
  const { profile, isStaff, isAdmin } = useAuth(); const toast = useToast(); const qc = useQueryClient();
  const ref = useRef<HTMLInputElement>(null); const [busy, setBusy] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['leadFiles', leadId], queryFn: async () => unwrap(await supabase.from('attachments').select('*').eq('lead_id', leadId).order('created_at', { ascending: false })) as { id: string; path: string; file_name: string; size_bytes: number | null; entity_type: string; created_at: string; uploaded_by: string | null }[] });
  async function upload(files: FileList | null) {
    if (!files?.length) return; setBusy(true);
    try { for (const f of Array.from(files)) await uploadFile(leadId, 'attachment', f, 'lead', null, profile!.id); qc.invalidateQueries({ queryKey: ['leadFiles', leadId] }); toast('File uploaded', 'ok'); }
    catch (e) { toast((e as Error).message, 'bad'); } finally { setBusy(false); if (ref.current) ref.current.value = ''; }
  }
  async function remove(a: { id: string; path: string }) {
    if (!confirm('Delete this file?')) return;
    const r = await supabase.storage.from('crm-files').remove([a.path]); if (r.error) { toast(r.error.message, 'bad'); return; }
    const d = await supabase.from('attachments').delete().eq('id', a.id); if (d.error) { toast(d.error.message, 'bad'); return; }
    qc.invalidateQueries({ queryKey: ['leadFiles', leadId] });
  }
  return (
    <div className="card">
      <div className="card-head"><h2 className="row"><Paperclip size={16} /> Files</h2>
        {isStaff && <><input ref={ref} type="file" multiple hidden onChange={(e) => upload(e.target.files)} /><button className="btn sm" disabled={busy} onClick={() => ref.current?.click()}><Upload /> {busy ? 'Uploading…' : 'Upload'}</button></>}</div>
      {isLoading ? <Loading /> : !data?.length ? <Empty>No files yet. Files are stored privately and opened with a short-lived link.</Empty> : (
        <table className="t"><tbody>
          {data.map((a) => (
            <tr key={a.id}><td>{a.file_name}<div className="muted small">{a.entity_type} · {fmtDate(a.created_at)}{a.size_bytes ? ` · ${(a.size_bytes / 1024).toFixed(0)} KB` : ''}</div></td>
              <td className="r"><button className="btn sm" onClick={() => openFile(a.path).catch((e) => toast(e.message, 'bad'))}><Download /> Open</button>{(isAdmin || a.uploaded_by === profile?.id) && <button className="btn sm ghost" onClick={() => remove(a)} aria-label="Delete file"><Trash2 /></button>}</td></tr>
          ))}
        </tbody></table>
      )}
    </div>
  );
}
