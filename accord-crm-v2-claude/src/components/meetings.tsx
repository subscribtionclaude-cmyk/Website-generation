import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, unwrap } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { Modal, Field, Select, ErrorNote, UserSelect } from './ui';
import { CONFIRMATION, MEETING_TYPES, NOT_ATTENDED_REASONS, MEETING_OUTCOMES, NEXT_STEPS } from '../lib/labels';
import { fromLocalInput, toLocalInput, cairoToday, addDays } from '../lib/cairo';
import type { Meeting } from '../lib/types';
import { t } from '../lib/i18n';

export function useInvalidateMeetings() {
  const qc = useQueryClient();
  return (leadId?: string) => {
    // resolves once the visible lists have refetched, so the confirmation never appears next to stale data
    const keys: unknown[][] = [['meetings'], ['leads'], ['dashboard'], ['followups'], ['proposals'], ['callMetrics'], ...(leadId ? [['lead', leadId], ['activities', leadId], ['leadMeetings', leadId]] : [])];
    return Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: k }))).then(() => undefined);
  };
}

interface FormProps {
  leadId: string; leadName: string; mode: 'requested' | 'scheduled'; onClose: (created: boolean) => void;
  contactId?: string | null; callPromise?: Promise<{ id: string }> | null; editing?: Meeting; proposalId?: string | null; purposeDefault?: string;
}

/** Create / edit a meeting. "requested" needs no date; "scheduled" needs one. */
export function MeetingFormDialog({ leadId, leadName, mode, onClose, contactId, callPromise, editing, proposalId, purposeDefault }: FormProps) {
  const { profile, isAdmin } = useAuth();
  const toast = useToast();
  const inv = useInvalidateMeetings();
  const [at, setAt] = useState(toLocalInput(editing?.scheduled_at));
  const [type, setType] = useState(editing?.meeting_type ?? 'physical');
  const [location, setLocation] = useState(editing?.location ?? '');
  const [link, setLink] = useState(editing?.online_link ?? '');
  const [conf, setConf] = useState(editing?.confirmation_status ?? 'unconfirmed');
  const [withWho, setWithWho] = useState(editing?.meeting_with ?? '');
  const [purpose, setPurpose] = useState(editing?.purpose ?? purposeDefault ?? '');
  const [agenda, setAgenda] = useState(editing?.agenda ?? '');
  const [internal, setInternal] = useState(editing?.internal_attendees ?? '');
  const [owner, setOwner] = useState(editing?.owner_id ?? profile!.id);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const scheduling = mode === 'scheduled';

  async function save() {
    setErr(null);
    if (scheduling && !at) { setErr(new Error(t('Date and time are required to schedule a meeting'))); return; }
    setBusy(true);
    try {
      const row: Record<string, unknown> = {
        meeting_with: withWho.trim() || null, purpose: purpose.trim() || null, agenda: agenda.trim() || null, owner_id: owner,
        meeting_type: type, location: location.trim() || null, online_link: link.trim() || null, confirmation_status: conf,
        internal_attendees: internal.trim() || null,
      };
      if (scheduling) { row.scheduled_at = fromLocalInput(at); row.status = 'scheduled'; }
      if (editing) {
        unwrap(await supabase.from('meetings').update(row).eq('id', editing.id).select('id'));
      } else {
        const callId = callPromise ? (await callPromise).id : null;
        const m = unwrap(await supabase.from('meetings').insert({
          ...row, lead_id: leadId, contact_id: contactId ?? null, status: scheduling ? 'scheduled' : 'requested',
          created_by: profile!.id, created_from_call_id: callId, proposal_id: proposalId ?? null,
        }).select('id').single()) as { id: string };
        if (callId) unwrap(await supabase.from('call_attempts').update({ meeting_id: m.id, sub_outcome: scheduling ? 'meeting_scheduled' : 'meeting_requested' }).eq('id', callId).select('id'));
      }
      await inv(leadId);
      toast(editing ? t('Meeting updated') : scheduling ? t('Meeting scheduled') : t('Meeting request recorded'), 'ok');
      onClose(true);
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }

  return (
    <Modal wide title={t(editing ? 'Edit meeting · {name}' : scheduling ? 'Schedule meeting · {name}' : 'Request meeting · {name}', { name: leadName })} onClose={() => onClose(false)}
      footer={<><button className="btn" onClick={() => onClose(false)}>{t('Cancel')}</button><button className="btn primary" disabled={busy} onClick={save}>{editing ? t('Save') : scheduling ? t('Schedule') : t('Record request')}</button></>}>
      <ErrorNote error={err} />
      <div className="form-grid">
        {scheduling && <Field label={t('Date & time (Cairo)')}><input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></Field>}
        <Field label={t('Meeting with')}><input value={withWho} onChange={(e) => setWithWho(e.target.value)} placeholder={t('Name / role')} /></Field>
        <Field label={t('Meeting type')}><Select value={type} onChange={setType} options={MEETING_TYPES} /></Field>
        {scheduling && <Field label={t('Confirmation')}><Select value={conf} onChange={setConf} options={CONFIRMATION} /></Field>}
        {type === 'online' || type === 'phone'
          ? <Field label={type === 'online' ? t('Meeting link') : t('Dial-in / number')} full><input value={link} onChange={(e) => setLink(e.target.value)} /></Field>
          : <Field label={t('Location')} full><input value={location} onChange={(e) => setLocation(e.target.value)} /></Field>}
        <Field label={t('Owner')}><UserSelect value={owner} onChange={setOwner} /></Field>
        <Field label={t('ACCORD attendees')}><input value={internal} onChange={(e) => setInternal(e.target.value)} /></Field>
        <Field label={t('Purpose')} full><input value={purpose} onChange={(e) => setPurpose(e.target.value)} /></Field>
        <Field label={t('Agenda')} full><textarea value={agenda} onChange={(e) => setAgenda(e.target.value)} /></Field>
      </div>
      {isAdmin ? null : null}
    </Modal>
  );
}

/** Explicit attendance — never inferred from the clock. */
export function AttendanceDialog({ meeting, leadName, onClose }: { meeting: Meeting; leadName: string; onClose: (r?: 'attended' | 'not_attended') => void }) {
  const toast = useToast();
  const inv = useInvalidateMeetings();
  const [attended, setAttended] = useState<boolean | null>(null);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [again, setAgain] = useState<boolean | null>(null);
  const [rAt, setRAt] = useState(toLocalInput(new Date(Date.now() + 3 * 86400000).toISOString()));
  const [rWith, setRWith] = useState(meeting.meeting_with ?? '');
  const [rType, setRType] = useState(meeting.meeting_type);
  const [rConf, setRConf] = useState('unconfirmed');
  const [rPurpose, setRPurpose] = useState(meeting.purpose ?? '');
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setErr(null);
    if (attended === null) { setErr(new Error(t('Choose Attended or Not Attended'))); return; }
    if (attended === false && !reason) { setErr(new Error(t('A reason is required'))); return; }
    if (attended === false && reason === 'rescheduled' && !again) { setErr(new Error(t('A replacement meeting is required when the reason is "Rescheduled"'))); return; }
    if (attended === false && again && !rAt) { setErr(new Error(t('Enter the replacement meeting date and time'))); return; }
    setBusy(true);
    try {
      const replacement = attended === false && again ? {
        scheduled_at: fromLocalInput(rAt), meeting_type: rType, confirmation_status: rConf, meeting_with: rWith || null, purpose: rPurpose || null,
      } : null;
      unwrap(await supabase.rpc('record_meeting_attendance', { p_meeting: meeting.id, p_attended: attended, p_reason: attended ? null : reason, p_notes: notes || null, p_replacement: replacement }));
      await inv(meeting.lead_id);
      toast(attended ? t('Marked attended') : again ? t('Marked not attended — replacement meeting created') : t('Marked not attended'), 'ok');
      onClose(attended ? 'attended' : 'not_attended');
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }

  return (
    <Modal wide title={t('Meeting outcome · {name}', { name: leadName })} onClose={() => onClose()}
      footer={<><button className="btn" onClick={() => onClose()}>{t('Cancel')}</button><button className="btn primary" disabled={busy} onClick={save}>{t('Save')}</button></>}>
      <ErrorNote error={err} />
      <div className="call-big">
        <button className={`btn ${attended === true ? 'ok' : ''}`} onClick={() => setAttended(true)} data-testid="att-yes">{t('Attended')}</button>
        <button className={`btn ${attended === false ? 'bad' : ''}`} onClick={() => setAttended(false)} data-testid="att-no">{t('Not Attended')}</button>
      </div>
      {attended === false && (
        <>
          <div className="form-grid">
            <Field label={t('Reason (required)')}><Select value={reason} onChange={setReason} options={NOT_ATTENDED_REASONS} placeholder={t('Select a reason…')} /></Field>
            <Field label={t('Notes')}><input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          </div>
          <div className="field"><label>{t('Another meeting required?')}</label>
            <div className="chips">
              <button className={`chip ${again === true ? 'on' : ''}`} onClick={() => setAgain(true)}>{t('Yes')}</button>
              <button className={`chip ${again === false ? 'on' : ''}`} onClick={() => setAgain(false)}>{t('No')}</button>
            </div>
          </div>
          {again && (
            <div className="card card-pad form-grid">
              <Field label={t('New date & time (Cairo)')}><input type="datetime-local" value={rAt} onChange={(e) => setRAt(e.target.value)} /></Field>
              <Field label={t('Meeting with')}><input value={rWith} onChange={(e) => setRWith(e.target.value)} /></Field>
              <Field label={t('Type')}><Select value={rType} onChange={setRType} options={MEETING_TYPES} /></Field>
              <Field label={t('Confirmation')}><Select value={rConf} onChange={setRConf} options={CONFIRMATION} /></Field>
              <Field label={t('Purpose')} full><input value={rPurpose} onChange={(e) => setRPurpose(e.target.value)} /></Field>
              <span className="muted small full">{t('The original meeting is preserved; the new meeting is linked to it.')}</span>
            </div>
          )}
        </>
      )}
      {attended === true && <div className="notice">{t('After saving you can record the minutes, outcome and next step.')}</div>}
    </Modal>
  );
}

/** Minutes of meeting, outcome, next step, optional next meeting + follow-up. */
export function OutcomeDialog({ meeting, leadName, onClose }: { meeting: Meeting; leadName: string; onClose: () => void }) {
  const toast = useToast();
  const inv = useInvalidateMeetings();
  const [f, setF] = useState({
    meeting_with: meeting.meeting_with ?? '', external_attendees: meeting.external_attendees ?? '', internal_attendees: meeting.internal_attendees ?? '',
    summary: meeting.summary ?? '', minutes_of_meeting: meeting.minutes_of_meeting ?? '', client_requirements: meeting.client_requirements ?? '',
    discussion_points: meeting.discussion_points ?? '', agreements: meeting.agreements ?? '', commitments: meeting.commitments ?? '',
    requested_documents: meeting.requested_documents ?? '', commercial_notes: meeting.commercial_notes ?? '',
    meeting_outcome: meeting.meeting_outcome ?? '', next_step: meeting.next_step ?? '', next_step_detail: meeting.next_step_detail ?? '',
  });
  const [fu, setFu] = useState(meeting.next_follow_up_at ?? '');
  const [nextReq, setNextReq] = useState(false);
  const [nAt, setNAt] = useState('');
  const [nWith, setNWith] = useState(meeting.meeting_with ?? '');
  const [nType, setNType] = useState(meeting.meeting_type);
  const [nConf, setNConf] = useState('unconfirmed');
  const [nPurpose, setNPurpose] = useState('Follow-up meeting');
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const today = cairoToday();

  async function save() {
    setErr(null);
    if (nextReq && !nAt) { setErr(new Error(t('Enter the next meeting date and time, or untick "Next meeting required"'))); return; }
    setBusy(true);
    try {
      const data: Record<string, unknown> = { ...f, next_meeting_required: nextReq || meeting.next_meeting_required || false };
      const next = nextReq ? { scheduled_at: fromLocalInput(nAt), meeting_type: nType, confirmation_status: nConf, meeting_with: nWith || null, purpose: nPurpose || null } : null;
      unwrap(await supabase.rpc('save_meeting_outcome', { p_meeting: meeting.id, p_data: data, p_next_meeting: next, p_follow_up_date: fu && fu !== meeting.next_follow_up_at ? fu : null }));
      await inv(meeting.lead_id);
      toast(t('Minutes & outcome saved'), 'ok');
      onClose();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  const T = (k: keyof typeof f, label: string, tall?: boolean, full = true) => (
    <Field label={label} full={full}><textarea className={tall ? 'tall' : ''} value={f[k]} onChange={(e) => set(k)(e.target.value)} /></Field>
  );

  return (
    <Modal wide title={t('Minutes & next step · {name}', { name: leadName })} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{t('Cancel')}</button><button className="btn primary" disabled={busy} onClick={save}>{t('Save minutes')}</button></>}>
      <ErrorNote error={err} />
      <div className="form-grid">
        <Field label={t('Meeting with')}><input value={f.meeting_with} onChange={(e) => set('meeting_with')(e.target.value)} /></Field>
        <Field label={t('Actual attendees (client)')}><input value={f.external_attendees} onChange={(e) => set('external_attendees')(e.target.value)} /></Field>
        <Field label={t('ACCORD attendees')} full><input value={f.internal_attendees} onChange={(e) => set('internal_attendees')(e.target.value)} /></Field>
        {T('summary', 'Meeting summary')}
        {T('minutes_of_meeting', 'Minutes of meeting', true)}
        {T('client_requirements', 'Client requirements', false, false)}
        {T('discussion_points', 'Discussion points', false, false)}
        {T('agreements', 'Agreements', false, false)}
        {T('commitments', 'Commitments', false, false)}
        {T('requested_documents', 'Requested documents')}
        <Field label={t('Outcome')}><Select value={f.meeting_outcome} onChange={set('meeting_outcome')} options={MEETING_OUTCOMES} placeholder={t('Select…')} /></Field>
        <Field label={t('Next step')}><Select value={f.next_step} onChange={set('next_step')} options={NEXT_STEPS} placeholder={t('Select…')} /></Field>
        <Field label={t('Next step detail')} full><input value={f.next_step_detail} onChange={(e) => set('next_step_detail')(e.target.value)} /></Field>
        <Field label={t('Follow-up date')}><input type="date" min={today} value={fu} onChange={(e) => setFu(e.target.value)} /></Field>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          {[['Tomorrow', 1], ['3 days', 3], ['1 week', 7]].map(([l, n]) => <button key={l as string} className="chip" onClick={() => setFu(addDays(today, n as number))}>{t(l as string)}</button>)}
        </div>
        {T('commercial_notes', 'Commercial notes')}
      </div>
      <label className="row"><input type="checkbox" checked={nextReq} onChange={(e) => setNextReq(e.target.checked)} /> <b>{t('Next meeting required')}</b></label>
      {nextReq && (
        <div className="card card-pad form-grid">
          <Field label={t('Date & time (Cairo)')}><input type="datetime-local" value={nAt} onChange={(e) => setNAt(e.target.value)} /></Field>
          <Field label={t('Meeting with')}><input value={nWith} onChange={(e) => setNWith(e.target.value)} /></Field>
          <Field label={t('Type')}><Select value={nType} onChange={setNType} options={MEETING_TYPES} /></Field>
          <Field label={t('Confirmation')}><Select value={nConf} onChange={setNConf} options={CONFIRMATION} /></Field>
          <Field label={t('Purpose')} full><input value={nPurpose} onChange={(e) => setNPurpose(e.target.value)} /></Field>
        </div>
      )}
      <span className="muted small">{t('Saving minutes never changes the lead\'s temperature or pipeline stage.')}</span>
    </Modal>
  );
}

export function RescheduleDialog({ meeting, leadName, onClose }: { meeting: Meeting; leadName: string; onClose: () => void }) {
  const toast = useToast(); const inv = useInvalidateMeetings();
  const [at, setAt] = useState(''); const [conf, setConf] = useState('unconfirmed'); const [note, setNote] = useState('');
  const [err, setErr] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  async function save() {
    if (!at) { setErr(new Error(t('Choose the new date and time'))); return; }
    setBusy(true);
    try {
      unwrap(await supabase.rpc('reschedule_meeting', { p_meeting: meeting.id, p_scheduled_at: fromLocalInput(at), p_confirmation: conf, p_note: note || null }));
      await inv(meeting.lead_id); toast(t('Meeting rescheduled (original kept, new one linked)'), 'ok'); onClose();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return (
    <Modal narrow title={t('Reschedule · {name}', { name: leadName })} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{t('Cancel')}</button><button className="btn primary" disabled={busy} onClick={save}>{t('Reschedule')}</button></>}>
      <ErrorNote error={err} />
      <Field label={t('New date & time (Cairo)')}><input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></Field>
      <Field label={t('Confirmation')}><Select value={conf} onChange={setConf} options={CONFIRMATION} /></Field>
      <Field label={t('Note')}><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
    </Modal>
  );
}
