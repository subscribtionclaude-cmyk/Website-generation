import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Download, Printer, ChevronLeft, ChevronRight } from 'lucide-react';
import { PageHead, Loading, ErrorNote, Kpi } from '../../components/ui';
import { addDays, cairoToday, fmtDate, monthRange, presetRange, PRESET_LABELS, weekRange, prevMonthRange, type RangePreset } from '../../lib/cairo';
import { useAdminReport, CallsSection, MeetingsSection, CommercialSection, FollowUpsSection, PipelineSection, WinsLossesSection, CriticalSection, exportReport, type Report } from './shared';
import { t, tb } from '../../lib/i18n';

const TITLES: Record<string, string> = { daily: 'Daily report', weekly: 'Weekly report', monthly: 'Monthly report', board: 'Board / Executive report', custom: 'Custom range report' };

export default function AdminReports() {
  const { mode = 'daily' } = useParams();
  const today = cairoToday();
  const [day, setDay] = useState(today);
  const [anchor, setAnchor] = useState(today);
  const [preset, setPreset] = useState<RangePreset>('this_week');
  const [from, setFrom] = useState(addDays(today, -6)); const [to, setTo] = useState(today);

  let range: { from: string; to: string };
  if (mode === 'daily') range = { from: day, to: day };
  else if (mode === 'weekly') range = weekRange(anchor);
  else if (mode === 'monthly') range = monthRange(anchor);
  else if (mode === 'board') range = preset === 'custom' ? { from, to } : presetRange(preset, today);
  else range = { from, to };

  const rep = useAdminReport(range.from, range.to);
  const nav = (n: number) => {
    if (mode === 'daily') setDay(addDays(day, n));
    else if (mode === 'weekly') setAnchor(addDays(weekRange(anchor).from, 7 * n));
    else { const m = monthRange(anchor); setAnchor(n < 0 ? prevMonthRange(m.from).from : addDays(m.to, 1)); }
  };

  return (
    <>
      <PageHead title={t(TITLES[mode] ?? 'Report')} sub={<>{fmtDate(range.from)}{range.from !== range.to ? ` – ${fmtDate(range.to)}` : ''} · <bdi className="ltr">Africa/Cairo</bdi></>}
        actions={<span className="no-print row">
          {rep.data && <button className="btn" onClick={() => exportReport(rep.data!, mode)}><Download /> {t('CSV / Excel')}</button>}
          <button className="btn" onClick={() => window.print()}><Printer /> {t('Print / PDF')}</button></span>} />
      <div className="row no-print" style={{ marginBottom: 14 }}>
        {(mode === 'daily' || mode === 'weekly' || mode === 'monthly') && (
          <><button className="btn sm" onClick={() => nav(-1)}><ChevronLeft className="flip-rtl" /> {t('Previous')}</button>
            {mode === 'daily' && <input type="date" max={today} value={day} onChange={(e) => e.target.value && setDay(e.target.value)} style={{ width: 170 }} aria-label={t('Report date')} />}
            {mode !== 'daily' && <input type="date" value={anchor} onChange={(e) => e.target.value && setAnchor(e.target.value)} style={{ width: 170 }} aria-label={t('Any date in period')} />}
            <button className="btn sm" onClick={() => nav(1)}>{t('Next')} <ChevronRight className="flip-rtl" /></button>
            <button className="btn sm ghost" onClick={() => { setDay(today); setAnchor(today); }}>{t('Today')}</button></>)}
        {mode === 'board' && (['today', 'yesterday', 'this_week', 'previous_week', 'this_month', 'previous_month', 'custom'] as RangePreset[]).map((p) => <button key={p} className={`chip ${preset === p ? 'on' : ''}`} onClick={() => setPreset(p)}>{PRESET_LABELS[p]}</button>)}
        {(mode === 'custom' || (mode === 'board' && preset === 'custom')) && (
          <><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 160 }} aria-label={t('From')} /><span className="flip-rtl" style={{ display: 'inline-block' }}>→</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 160 }} aria-label={t('To')} /></>)}
      </div>
      <ErrorNote error={rep.error} />
      {rep.isLoading ? <Loading /> : rep.data && (mode === 'board' ? <Board r={rep.data} /> : (
        <div className="col" style={{ gap: 22 }}>
          <CallsSection r={rep.data} /><MeetingsSection r={rep.data} /><CommercialSection r={rep.data} /><FollowUpsSection r={rep.data} />
          <PipelineSection r={rep.data} /><WinsLossesSection r={rep.data} /><CriticalSection r={rep.data} />
        </div>
      ))}
    </>
  );
}

function Board({ r }: { r: Report }) {
  const c = r.calls; const m = r.meetings; const co = r.commercial;
  const top = [...c.by_user].sort((a, b) => b.total - a.total)[0];
  return (
    <div className="col" style={{ gap: 22 }}>
      <section className="card card-pad col kpi hero" aria-label={t('Executive summary')}>
        <h2>{t('Executive summary')}</h2>
        <ul style={{ margin: 0, paddingInlineStart: 18 }} className="col">
          <li>{tb('The team logged {total} call attempts across {unique} unique leads; {responded} connected ({rate}%).', { total: c.total, unique: c.unique_leads, responded: c.responded, rate: c.response_rate ?? '—' })}</li>
          <li>{c.target > 0
            ? <>{tb('Against a combined working-day target of {target}, achievement is {pct}%.', { target: c.target, pct: c.achievement_pct })}{c.remaining > 0 ? ` ${t('({n} calls short)', { n: c.remaining })}` : ''}</>
            : t('No call targets are set for this period.')}</li>
          <li>{tb('{scheduled} meetings were scheduled ({confirmed} confirmed), {attended} attended and {not} not attended; {fromCalls} originated from calls.', { scheduled: m.scheduled, confirmed: m.confirmed, attended: m.attended, not: m.not_attended, fromCalls: m.generated_from_calls })}</li>
          <li>{tb('{sent} proposals sent, {awaiting} awaiting client response; {won} won / {lost} lost.', { sent: co.proposals_sent, awaiting: co.awaiting_responses, won: co.won, lost: co.lost })}</li>
          {top && top.total > 0 && <li>{tb('Top caller: {name} with {n} attempts.', { name: top.name, n: top.total })}</li>}
        </ul>
        <span className="muted small">{t('Figures are computed from recorded activity only — nothing is estimated.')}</span>
      </section>
      <div className="grid cols-4 keep2"><Kpi hero label={t('Calls')} value={c.total} /><Kpi label={t('Target achievement')} value={c.achievement_pct === null ? '—' : `${c.achievement_pct}%`} /><Kpi label={t('Meetings attended')} value={m.attended} /><Kpi label={t('Proposals sent')} value={co.proposals_sent} /></div>
      <CallsSection r={r} showDays={false} /><MeetingsSection r={r} /><CommercialSection r={r} /><PipelineSection r={r} /><WinsLossesSection r={r} /><CriticalSection r={r} />
    </div>
  );
}
