import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarCheck, FileText, RefreshCcw, Pencil, XCircle, CheckCircle2, Video, MapPin, PhoneCall } from 'lucide-react';
import { supabase, unwrap } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { AttendanceDialog, OutcomeDialog, RescheduleDialog, MeetingFormDialog, useInvalidateMeetings } from './meetings';
import { fmtDateTime } from '../lib/cairo';
import { label, MEETING_TYPES, MEETING_OUTCOMES, NEXT_STEPS, NOT_ATTENDED_REASONS, CONFIRMATION } from '../lib/labels';
import type { Meeting } from '../lib/types';

export function MeetingCard({ m, showLead = true }: { m: Meeting; showLead?: boolean }) {
  const { profile, isAdmin, isStaff } = useAuth();
  const toast = useToast(); const inv = useInvalidateMeetings();
  const [dlg, setDlg] = useState<null | 'att' | 'out' | 'res' | 'edit' | 'sched'>(null);
  const [open, setOpen] = useState(false);
  const mine = isAdmin || m.owner_id === profile?.id;
  const can = isStaff && mine;
  const leadName = m.leads?.name ?? '';
  const past = m.scheduled_at ? new Date(m.scheduled_at).getTime() < Date.now() : false;
  const awaiting = m.status === 'scheduled' && m.attendance_status === 'pending' && past;
  const Icon = m.meeting_type === 'online' ? Video : m.meeting_type === 'phone' ? PhoneCall : MapPin;

  async function patch(p: Record<string, unknown>, msg: string) {
    try { unwrap(await supabase.from('meetings').update(p).eq('id', m.id).select('id')); inv(m.lead_id); toast(msg, 'ok'); } catch (e) { toast((e as Error).message, 'bad'); }
  }
  const statusBadge = m.attendance_status === 'attended' ? <span className="badge ok">Attended</span>
    : m.attendance_status === 'not_attended' ? <span className="badge bad">Not attended</span>
    : m.status === 'cancelled' ? <span className="badge">Cancelled</span> : m.status === 'rescheduled' ? <span className="badge warn">Rescheduled</span>
    : m.status === 'requested' ? <span className="badge info">Requested</span>
    : awaiting ? <span className="badge warn">Awaiting outcome</span> : <span className="badge info">Scheduled</span>;

  return (
    <div className="card card-pad col" data-testid="meeting-card">
      <div className="row spread nowrap" style={{ alignItems: 'flex-start' }}>
        <div className="col" style={{ gap: 2 }}>
          {showLead && <Link to={`/leads/view/?id=${m.lead_id}`}><b>{leadName}</b></Link>}
          <div className="row"><Icon size={14} /><b className="num">{m.scheduled_at ? fmtDateTime(m.scheduled_at) : 'Date not set yet'}</b>
            <span className="muted">· {label(MEETING_TYPES, m.meeting_type)}{m.meeting_with ? ` · ${m.meeting_with}` : ''}</span></div>
          {(m.location || m.online_link) && <span className="muted small">{m.online_link ? <a href={m.online_link} target="_blank" rel="noopener noreferrer">{m.online_link}</a> : m.location}</span>}
          {m.purpose && <span className="small">{m.purpose}</span>}
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          {statusBadge}
          {m.status !== 'requested' && m.status !== 'cancelled' && <span className={`badge ${m.confirmation_status === 'confirmed' ? 'ok' : 'warn'}`}>{label(CONFIRMATION, m.confirmation_status)}</span>}
        </div>
      </div>
      {m.rescheduled_from_id && <span className="muted small">↳ Replacement for an earlier meeting</span>}
      {m.follows_meeting_id && <span className="muted small">↳ Follow-up to a previous meeting</span>}
      {m.attendance_status === 'not_attended' && <span className="muted small">Reason: {label(NOT_ATTENDED_REASONS, m.not_attended_reason)}{m.not_attended_notes ? ` — ${m.not_attended_notes}` : ''}</span>}
      {m.attendance_status === 'attended' && (m.meeting_outcome || m.next_step) && (
        <div className="row small">{m.meeting_outcome && <span className="badge">Outcome: {label(MEETING_OUTCOMES, m.meeting_outcome)}</span>}{m.next_step && <span className="badge">Next: {label(NEXT_STEPS, m.next_step)}</span>}</div>
      )}
      {open && (m.minutes_of_meeting || m.summary) && <div className="notice pre">{m.summary && <p><b>Summary:</b> {m.summary}</p>}{m.minutes_of_meeting && <><b>Minutes</b><div>{m.minutes_of_meeting}</div></>}{m.next_step_detail && <p><b>Next step:</b> {m.next_step_detail}</p>}</div>}
      <div className="row">
        {can && m.status === 'requested' && <button className="btn sm primary" onClick={() => setDlg('sched')}><CalendarCheck /> Schedule</button>}
        {can && m.status === 'scheduled' && m.attendance_status === 'pending' && (
          <>
            {m.confirmation_status !== 'confirmed'
              ? <button className="btn sm" onClick={() => patch({ confirmation_status: 'confirmed' }, 'Meeting confirmed')}><CheckCircle2 /> Confirm</button>
              : <button className="btn sm" onClick={() => patch({ confirmation_status: 'unconfirmed' }, 'Marked unconfirmed')}>Unconfirm</button>}
            <button className={`btn sm ${awaiting ? 'primary' : ''}`} onClick={() => setDlg('att')} data-testid="record-outcome">Attended / Not attended</button>
            <button className="btn sm" onClick={() => setDlg('res')}><RefreshCcw /> Reschedule</button>
            <button className="btn sm ghost" onClick={() => setDlg('edit')}><Pencil /> Edit</button>
            <button className="btn sm ghost" onClick={() => { if (confirm('Cancel this meeting?')) patch({ status: 'cancelled' }, 'Meeting cancelled'); }}><XCircle /> Cancel</button>
          </>
        )}
        {can && m.attendance_status === 'attended' && <button className="btn sm" onClick={() => setDlg('out')}><FileText /> {m.minutes_of_meeting ? 'Edit minutes' : 'Add minutes'}</button>}
        {(m.minutes_of_meeting || m.summary) && <button className="btn sm ghost" onClick={() => setOpen(!open)}>{open ? 'Hide minutes' : 'View minutes'}</button>}
      </div>
      {dlg === 'att' && <AttendanceDialog meeting={m} leadName={leadName} onClose={(r) => { setDlg(r === 'attended' ? 'out' : null); }} />}
      {dlg === 'out' && <OutcomeDialog meeting={m} leadName={leadName} onClose={() => setDlg(null)} />}
      {dlg === 'res' && <RescheduleDialog meeting={m} leadName={leadName} onClose={() => setDlg(null)} />}
      {dlg === 'edit' && <MeetingFormDialog leadId={m.lead_id} leadName={leadName} mode="scheduled" editing={m} onClose={() => setDlg(null)} />}
      {dlg === 'sched' && <MeetingFormDialog leadId={m.lead_id} leadName={leadName} mode="scheduled" editing={m} onClose={() => setDlg(null)} />}
    </div>
  );
}
