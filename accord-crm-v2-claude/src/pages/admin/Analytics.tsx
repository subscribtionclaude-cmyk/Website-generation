import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { PageHead, Loading, ErrorNote } from '../../components/ui';
import { cairoDayStart, addDays, cairoToday, fmtDate, presetRange, PRESET_LABELS, type RangePreset } from '../../lib/cairo';
import { MEETING_OUTCOMES, NOT_ATTENDED_REASONS, MEETING_TYPES, PROPOSAL_STATUS, STAGES, STAGE_LABEL, TEMPERATURES, TEMP_LABEL, label } from '../../lib/labels';
import { useAdminReport, CallsSection, MeetingsSection, CommercialSection, PipelineSection, FollowUpsSection } from './shared';
import { t } from '../../lib/i18n';

const TITLES: Record<string, string> = { calls: 'Calls analytics', meetings: 'Meetings analytics', commercial: 'Commercial / proposal analytics', pipeline: 'Pipeline analytics' };
const tally = <T,>(rows: T[], key: (r: T) => string | null | undefined) => { const m = new Map<string, number>(); for (const r of rows) { const k = key(r) ?? '—'; m.set(k, (m.get(k) ?? 0) + 1); } return [...m.entries()].sort((a, b) => b[1] - a[1]); };
function Breakdown({ title, rows, fmt }: { title: string; rows: [string, number][]; fmt?: (k: string) => string }) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return <div className="card card-pad col"><h3>{title}</h3>{rows.length === 0 && <span className="muted">{t('No data.')}</span>}{rows.map(([k, n]) => <div key={k} className="hbar"><span>{fmt ? fmt(k) : k}</span><div className="track"><i style={{ width: `${(100 * n) / max}%` }} /></div><b className="num">{n}</b></div>)}</div>;
}

export default function AdminAnalytics() {
  const { focus = 'calls' } = useParams();
  const [preset, setPreset] = useState<RangePreset>('this_month');
  const today = cairoToday();
  const range = presetRange(preset, today);
  const rep = useAdminReport(range.from, range.to);
  const t0 = cairoDayStart(range.from).toISOString(); const t1 = cairoDayStart(addDays(range.to, 1)).toISOString();

  const meetings = useQuery({ queryKey: ['anMeetings', range.from, range.to], enabled: focus === 'meetings', queryFn: async () => {
    const { data, error } = await supabase.from('meetings').select('meeting_type,meeting_outcome,not_attended_reason,attendance_status,confirmation_status').gte('scheduled_at', t0).lt('scheduled_at', t1).limit(5000);
    if (error) throw new Error(error.message); return data as { meeting_type: string; meeting_outcome: string | null; not_attended_reason: string | null; attendance_status: string; confirmation_status: string }[]; } });
  const proposals = useQuery({ queryKey: ['anProposals'], enabled: focus === 'commercial', queryFn: async () => {
    const { data, error } = await supabase.from('proposals').select('status,value,currency').limit(5000); if (error) throw new Error(error.message); return data as { status: string; value: number | null; currency: string }[]; } });
  const leads = useQuery({ queryKey: ['anLeads'], enabled: focus === 'pipeline', queryFn: async () => {
    const { data, error } = await supabase.from('leads').select('temperature,pipeline_stage').eq('archived', false).limit(10000); if (error) throw new Error(error.message); return data as { temperature: string; pipeline_stage: string }[]; } });

  return (
    <>
      <PageHead title={TITLES[focus] ?? 'Analytics'} sub={`${fmtDate(range.from)} – ${fmtDate(range.to)} · Africa/Cairo`} />
      <div className="row" style={{ marginBottom: 14 }}>{(['today', 'yesterday', 'this_week', 'previous_week', 'this_month', 'previous_month'] as RangePreset[]).map((p) => <button key={p} className={`chip ${preset === p ? 'on' : ''}`} onClick={() => setPreset(p)}>{PRESET_LABELS[p]}</button>)}</div>
      <ErrorNote error={rep.error ?? meetings.error ?? proposals.error ?? leads.error} />
      {rep.isLoading ? <Loading /> : rep.data && (
        <div className="col" style={{ gap: 20 }}>
          {focus === 'calls' && <><CallsSection r={rep.data} /><FollowUpsSection r={rep.data} /></>}
          {focus === 'meetings' && <>
            <MeetingsSection r={rep.data} />
            {meetings.data && <div className="grid cols-3">
              <Breakdown title={t('By type')} rows={tally(meetings.data, (m) => m.meeting_type)} fmt={(k) => label(MEETING_TYPES, k)} />
              <Breakdown title={t('Outcome of attended meetings')} rows={tally(meetings.data.filter((m) => m.attendance_status === 'attended'), (m) => m.meeting_outcome)} fmt={(k) => (k === '—' ? 'No outcome recorded' : label(MEETING_OUTCOMES, k))} />
              <Breakdown title={t('Not-attended reasons')} rows={tally(meetings.data.filter((m) => m.attendance_status === 'not_attended'), (m) => m.not_attended_reason)} fmt={(k) => label(NOT_ATTENDED_REASONS, k)} />
            </div>}</>}
          {focus === 'commercial' && <>
            <CommercialSection r={rep.data} />
            {proposals.data && <Breakdown title={t('All proposals by status (current)')} rows={tally(proposals.data, (p) => p.status)} fmt={(k) => label(PROPOSAL_STATUS, k)} />}</>}
          {focus === 'pipeline' && <>
            <PipelineSection r={rep.data} />
            {leads.data && <div className="card table-wrap"><table className="t" aria-label={t('Temperature by stage')}><thead><tr><th>{t('Stage')}</th>{TEMPERATURES.map((t) => <th key={t} className="r">{TEMP_LABEL[t]}</th>)}<th className="r">{t('Total')}</th></tr></thead><tbody>
              {STAGES.map((s) => <tr key={s}><td>{STAGE_LABEL[s]}</td>{TEMPERATURES.map((t) => <td key={t} className="r num">{leads.data!.filter((l) => l.pipeline_stage === s && l.temperature === t).length}</td>)}<td className="r num"><b>{leads.data!.filter((l) => l.pipeline_stage === s).length}</b></td></tr>)}
            </tbody></table><div className="card-pad muted small">{t('Temperature and pipeline stage are independent — every combination is valid.')}</div></div>}</>}
        </div>
      )}
    </>
  );
}
