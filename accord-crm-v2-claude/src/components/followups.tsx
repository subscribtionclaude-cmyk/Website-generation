import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, unwrap } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { Modal, Field, ErrorNote, UserSelect } from './ui';
import { addDays, cairoToday } from '../lib/cairo';
import type { FollowUp } from '../lib/types';
import { t } from '../lib/i18n';

function useInv() {
  const qc = useQueryClient();
  return (leadId?: string) => {
    for (const k of [['followups'], ['leads'], ['dashboard']]) qc.invalidateQueries({ queryKey: k });
    if (leadId) for (const k of [['lead', leadId], ['activities', leadId], ['leadFollowUps', leadId]]) qc.invalidateQueries({ queryKey: k });
  };
}

export function FollowUpFormDialog({ leadId, leadName, editing, onClose, origin = 'manual' }: { leadId: string; leadName: string; editing?: FollowUp; onClose: () => void; origin?: string }) {
  const { profile } = useAuth(); const toast = useToast(); const inv = useInv();
  const [date, setDate] = useState(editing?.due_date ?? addDays(cairoToday(), 1));
  const [time, setTime] = useState(editing?.due_time?.slice(0, 5) ?? '');
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const [owner, setOwner] = useState(editing?.owner_id ?? profile!.id);
  const [err, setErr] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  async function save() {
    setErr(null); if (!date) { setErr(new Error('Choose a date')); return; }
    setBusy(true);
    try {
      const row = { due_date: date, due_time: time || null, notes: notes.trim() || null, owner_id: owner };
      if (editing) unwrap(await supabase.from('follow_ups').update(row).eq('id', editing.id).select('id'));
      else unwrap(await supabase.from('follow_ups').insert({ ...row, lead_id: leadId, title: 'Follow-up', origin, created_by: profile!.id }).select('id'));
      inv(leadId); toast('Follow-up saved', 'ok'); onClose();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  const td = cairoToday();
  return (
    <Modal narrow title={`${editing ? 'Reschedule' : 'New'} follow-up · ${leadName}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{t('Cancel')}</button><button className="btn primary" disabled={busy} onClick={save}>{t('Save')}</button></>}>
      <ErrorNote error={err} />
      <div className="chips">{[['Today', 0], ['Tomorrow', 1], ['In 3 days', 3], ['Next week', 7], ['In 2 weeks', 14]].map(([l, n]) => <button key={l as string} className={`chip ${date === addDays(td, n as number) ? 'on' : ''}`} onClick={() => setDate(addDays(td, n as number))}>{l}</button>)}</div>
      <div className="form-grid"><Field label={t('Date (Cairo)')}><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label={t('Time (optional)')}><input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field></div>
      <Field label={t('Owner')}><UserSelect value={owner} onChange={setOwner} /></Field>
      <Field label={t('Note')}><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
    </Modal>
  );
}

/** Complete a follow-up and (optionally) schedule the next one straight away. */
export function CompleteFollowUpDialog({ fu, leadName, onClose }: { fu: FollowUp; leadName: string; onClose: () => void }) {
  const toast = useToast(); const inv = useInv();
  const [next, setNext] = useState(''); const [note, setNote] = useState('');
  const [err, setErr] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const td = cairoToday();
  async function save(withNext: boolean) {
    setBusy(true); setErr(null);
    try {
      unwrap(await supabase.rpc('complete_follow_up', { p_id: fu.id, p_next_date: withNext && next ? next : null, p_next_note: note || null }));
      inv(fu.lead_id); toast(withNext && next ? 'Completed — next follow-up scheduled' : 'Follow-up completed', 'ok'); onClose();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return (
    <Modal narrow title={`Complete follow-up · ${leadName}`} onClose={onClose}
      footer={<><button className="btn" disabled={busy} onClick={() => save(false)}>{t('Complete only')}</button><button className="btn primary" disabled={busy || !next} onClick={() => save(true)}>{t('Complete + schedule next')}</button></>}>
      <ErrorNote error={err} />
      {fu.notes && <div className="notice">{fu.notes}</div>}
      <div className="field"><label>{t('Next follow-up')}</label>
        <div className="chips">{[['Tomorrow', 1], ['In 3 days', 3], ['Next week', 7], ['In 2 weeks', 14]].map(([l, n]) => <button key={l as string} className={`chip ${next === addDays(td, n as number) ? 'on' : ''}`} onClick={() => setNext(addDays(td, n as number))}>{l}</button>)}
          <input type="date" min={td} value={next} onChange={(e) => setNext(e.target.value)} style={{ width: 160 }} aria-label={t('Next follow-up date')} /></div></div>
      <Field label={t('Note for the next follow-up')}><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
    </Modal>
  );
}
