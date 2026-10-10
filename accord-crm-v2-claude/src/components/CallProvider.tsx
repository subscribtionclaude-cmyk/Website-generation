import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Phone, PhoneOff, PhoneCall, CheckCircle2, CalendarPlus, Handshake } from 'lucide-react';
import { supabase, unwrap } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { Modal, Field } from './ui';
import { MeetingFormDialog } from './meetings';
import { applyCall, type CallMetrics } from '../lib/metrics';
import { RESPONDED_SUBS, NO_RESPONSE_SUBS } from '../lib/labels';
import { addDays, cairoToday } from '../lib/cairo';
import { useActiveSession } from '../lib/hooks';
import type { Contact } from '../lib/types';
import { t, tb } from '../lib/i18n';

export interface CallTarget { id: string; name: string }
interface Ctx { startCall: (lead: CallTarget) => void }
const C = createContext<Ctx>({ startCall: () => {} });
export const useCall = () => useContext(C);

export function CallProvider({ children }: { children: ReactNode }) {
  const { isStaff, profile } = useAuth();
  const [lead, setLead] = useState<CallTarget | null>(null);
  const startCall = useCallback((l: CallTarget) => { if (isStaff) setLead(l); }, [isStaff]);
  const value = useMemo(() => ({ startCall }), [startCall]);
  return (
    <C.Provider value={value}>
      {children}
      {lead && profile && <CallDialog lead={lead} onClose={() => setLead(null)} />}
    </C.Provider>
  );
}

type Kind = 'responded' | 'did_not_respond';

function CallDialog({ lead, onClose }: { lead: CallTarget; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { profile } = useAuth();
  const { data: session } = useActiveSession();
  const [step, setStep] = useState<'choose' | 'saved'>('choose');
  const [kind, setKind] = useState<Kind | null>(null);
  const [contactId, setContactId] = useState('');
  const [sub, setSub] = useState('');
  const [note, setNote] = useState('');
  const [fuDate, setFuDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [meetingMode, setMeetingMode] = useState<null | 'requested' | 'scheduled'>(null);
  const callRef = useRef<Promise<{ id: string }> | null>(null);
  const today = cairoToday();

  const { data: contacts } = useQuery({
    queryKey: ['contacts', lead.id],
    queryFn: async () => unwrap(await supabase.from('contacts').select('*').eq('lead_id', lead.id).order('is_primary', { ascending: false })) as Contact[],
  });
  const phones = useMemo(() => [...new Set((contacts ?? []).flatMap((c) => c.phones))].slice(0, 6), [contacts]);

  // Persist immediately; the UI updates optimistically and rolls back if the write fails.
  const log = useCallback((k: Kind) => {
    if (callRef.current) return;
    setKind(k); setStep('saved');
    const key = ['callMetrics', profile?.id, today];
    const prev = qc.getQueryData<CallMetrics>(key);
    if (prev) qc.setQueryData(key, applyCall(prev, k, false));
    const p = (async () => {
      const res = await supabase.rpc('log_call', { p_lead_id: lead.id, p_outcome: k, p_contact_id: contactId || null, p_session_id: session?.id ?? null });
      return unwrap(res) as { id: string };
    })();
    callRef.current = p;
    p.then(() => {
      for (const k2 of [['callMetrics'], ['callMetricsRange'], ['myCallsToday'], ['leads'], ['lead', lead.id], ['followups'], ['dashboard'], ['activities', lead.id], ['sessionCalls']]) qc.invalidateQueries({ queryKey: k2 });
    }).catch((e: Error) => {
      if (prev) qc.setQueryData(key, prev);
      callRef.current = null;
      setStep('choose'); setKind(null);
      toast(t('Call NOT saved: {message}', { message: e.message }), 'bad');
    });
  }, [contactId, lead.id, profile?.id, qc, session?.id, toast, today]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (step !== 'choose' || (e.target as HTMLElement).closest('input,textarea,select')) return;
      if (e.key.toLowerCase() === 'r') log('responded');
      if (e.key.toLowerCase() === 'n' || e.key.toLowerCase() === 'd') log('did_not_respond');
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [step, log]);

  async function applyDetails(opts: { sub?: string; date?: string; noteText?: string; close?: boolean }) {
    setBusy(true);
    try {
      const call = await callRef.current!;
      const patch: Record<string, unknown> = {};
      if (opts.sub) patch.sub_outcome = opts.sub;
      if (opts.noteText?.trim()) patch.notes = opts.noteText.trim();
      if (opts.date) {
        const f = unwrap(await supabase.from('follow_ups').insert({
          lead_id: lead.id, contact_id: contactId || null, owner_id: profile!.id, created_by: profile!.id, title: 'Follow-up after call',
          notes: opts.noteText?.trim() || null, due_date: opts.date, origin: 'call', call_id: call.id,
        }).select('id').single()) as { id: string };
        patch.follow_up_id = f.id;
      }
      if (Object.keys(patch).length) unwrap(await supabase.from('call_attempts').update(patch).eq('id', call.id).select('id'));
      qc.invalidateQueries({ queryKey: ['followups'] }); qc.invalidateQueries({ queryKey: ['lead', lead.id] });
      qc.invalidateQueries({ queryKey: ['activities', lead.id] }); qc.invalidateQueries({ queryKey: ['myCallsToday'] }); qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast(t('Call details saved'), 'ok');
      if (opts.close !== false) onClose();
    } catch (e) { toast(t('Could not save details: {message}', { message: (e as Error).message }), 'bad'); } finally { setBusy(false); }
  }

  if (meetingMode) {
    return (
      <MeetingFormDialog leadId={lead.id} leadName={lead.name} mode={meetingMode} contactId={contactId || null}
        callPromise={callRef.current} onClose={(created) => { setMeetingMode(null); if (created) onClose(); }} />
    );
  }

  const subs = kind === 'did_not_respond' ? NO_RESPONSE_SUBS : RESPONDED_SUBS;
  return (
    <Modal title={<span className="row nowrap"><PhoneCall size={18} /> {t('Call · {name}', { name: lead.name })}</span>} onClose={onClose} narrow={step === 'choose'}
      footer={step === 'saved' ? <button className="btn primary" onClick={onClose} disabled={busy}>{t('Done')}</button> : undefined}>
      {step === 'choose' && (
        <>
          {phones.length > 0 && (
            <div className="row">{phones.map((p) => <a key={p} className="btn sm" href={`tel:${p}`}><Phone /> {p}</a>)}</div>
          )}
          {(contacts ?? []).length > 1 && (
            <Field label={t('Spoke / calling (optional)')}>
              <select value={contactId} onChange={(e) => setContactId(e.target.value)}>
                <option value="">{t('— not specified —')}</option>
                {(contacts ?? []).map((c) => <option key={c.id} value={c.id}>{c.full_name || t('Company line')}{c.job_title ? ` · ${c.job_title}` : ''}</option>)}
              </select>
            </Field>
          )}
          <div className="call-big">
            <button className="btn ok" onClick={() => log('responded')} autoFocus data-testid="call-responded"><Phone /> {t('Responded')}<small className="muted" style={{ color: '#fff', opacity: 0.8, fontWeight: 500 }}>R</small></button>
            <button className="btn bad" onClick={() => log('did_not_respond')} data-testid="call-no-response"><PhoneOff /> {t('Didn\'t Respond')}<small style={{ opacity: 0.8, fontWeight: 500 }}>N</small></button>
          </div>
          <span className="muted small">{t('Saved the moment you tap.')} {session ? t('Counted in your active calling session.') : ''}</span>
        </>
      )}
      {step === 'saved' && (
        <>
          <div className="notice ok row nowrap"><CheckCircle2 size={18} /> <span>{tb('{outcome} logged. Add details (optional):', { outcome: kind === 'responded' ? t('Responded') : t("Didn't respond") })}</span></div>
          {kind === 'responded' ? (
            <>
              <div className="chips">
                {subs.map(([k, l]) => <button key={k} className={`chip ${sub === k ? 'on' : ''}`} onClick={() => setSub(sub === k ? '' : k)}>{t(l as string)}</button>)}
              </div>
              <Field label={t('Note')}><textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('What was discussed?')} /></Field>
              <div className="field"><label>{t('Follow-up')}</label>
                <div className="chips">
                  {[['Tomorrow', 1], ['In 3 days', 3], ['Next week', 7]].map(([l, n]) => (
                    <button key={l as string} className={`chip ${fuDate === addDays(today, n as number) ? 'on' : ''}`} onClick={() => setFuDate(fuDate === addDays(today, n as number) ? '' : addDays(today, n as number))}>{t(l as string)}</button>
                  ))}
                  <input type="date" min={today} value={fuDate} onChange={(e) => setFuDate(e.target.value)} style={{ width: 160 }} aria-label={t('Follow-up date')} />
                </div>
              </div>
              <div className="row">
                <button className="btn" onClick={() => setMeetingMode('requested')}><Handshake /> {t('Meeting requested')}</button>
                <button className="btn" onClick={() => setMeetingMode('scheduled')}><CalendarPlus /> {t('Schedule meeting')}</button>
                <span className="grow" />
                <button className="btn primary" disabled={busy || (!sub && !note.trim() && !fuDate)} onClick={() => applyDetails({ sub, date: fuDate, noteText: note })}>{t('Save details')}</button>
              </div>
            </>
          ) : (
            <>
              <div className="chips">
                {NO_RESPONSE_SUBS.map(([k, l]) => (
                  <button key={k} className={`chip ${sub === k ? 'on' : ''}`} disabled={busy}
                    onClick={() => {
                      setSub(k);
                      if (k === 'retry_later_today') applyDetails({ sub: k, date: today });
                      else if (k === 'tomorrow') applyDetails({ sub: k, date: addDays(today, 1) });
                      else if (k === 'no_retry') applyDetails({ sub: k });
                    }}>{t(l as string)}</button>
                ))}
              </div>
              {sub === 'select_date' && (
                <div className="row">
                  <input type="date" min={today} value={fuDate} onChange={(e) => setFuDate(e.target.value)} style={{ width: 170 }} aria-label={t('Retry date')} />
                  <button className="btn primary" disabled={!fuDate || busy} onClick={() => applyDetails({ sub: 'select_date', date: fuDate })}>{t('Schedule retry')}</button>
                </div>
              )}
              <Field label={t('Note (optional)')}><textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
              {note.trim() && <button className="btn sm" disabled={busy} onClick={() => applyDetails({ noteText: note })}>{t('Save note')}</button>}
            </>
          )}
        </>
      )}
    </Modal>
  );
}
