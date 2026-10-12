import { useState } from 'react';
import { flushSync } from 'react-dom';
import { Link } from 'react-router-dom';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles, Search, Clock3, CalendarClock } from 'lucide-react';
import { supabase, unwrap } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { PageHead, TempBadge, Loading, ErrorNote, Modal, Select, useDebounced } from '../components/ui';
import { STAGES, STAGE_LABEL, FORM_STATUS, PROPOSAL_STATUS, label } from '../lib/labels';
import { fmtDate, cairoToday, fmtRelative } from '../lib/cairo';
import { Num } from '../components/viz';
import type { LeadRow } from '../lib/types';
import { t } from '../lib/i18n';

const LANE_LIMIT = 40;

export default function Pipeline() {
  const { profile, isStaff, isAdmin } = useAuth();
  const qc = useQueryClient(); const toast = useToast();
  const [mine, setMine] = useState(false);
  const [text, setText] = useState(''); const q = useDebounced(text.trim().toLowerCase());
  const [pending, setPending] = useState<{ lead: LeadRow; to: string } | null>(null);
  const [dropOn, setDropOn] = useState('');
  const [dragId, setDragId] = useState('');
  const [moving, setMoving] = useState('');
  const today = cairoToday();

  const lanes = useQueries({
    queries: STAGES.map((s) => ({
      queryKey: ['pipeline', s, mine, q, profile?.id],
      queryFn: async () => {
        let b = supabase.from('lead_list_v').select('*', { count: 'exact' }).eq('archived', false).eq('pipeline_stage', s);
        if (mine) b = b.eq('owner_id', profile!.id);
        if (q) b = b.ilike('search_text', `%${q.replace(/[%_,()]/g, ' ')}%`);
        const { data, count, error } = await b.order('last_activity_at', { ascending: false, nullsFirst: false }).limit(LANE_LIMIT);
        if (error) throw new Error(error.message);
        return { rows: data as LeadRow[], total: count ?? 0 };
      },
    })),
  });
  const stages = useQuery({ queryKey: ['stages'], staleTime: 300_000, queryFn: async () => unwrap(await supabase.from('pipeline_stages').select('key,label').order('position')) as { key: string; label: string }[] });
  const stageLabel = (k: string) => { const db = stages.data?.find((s) => s.key === k)?.label; return db ? t(db) : STAGE_LABEL[k]; };

  const canMove = (l: LeadRow) => isAdmin || (isStaff && (l.owner_id === null || l.owner_id === profile?.id));
  async function confirmMove() {
    if (!pending) return;
    try {
      unwrap(await supabase.from('leads').update({ pipeline_stage: pending.to }).eq('id', pending.lead.id).select('id'));
      // presentation only: move the card in the cached lanes inside a view transition so it glides to its new
      // column (the server already holds the new stage; the lanes are re-fetched right after)
      const { lead, to } = pending; const moved = { ...lead, pipeline_stage: to };
      const apply = () => {
        qc.setQueriesData<{ rows: LeadRow[]; total: number }>({ queryKey: ['pipeline', lead.pipeline_stage] }, (d) => d && { rows: d.rows.filter((x) => x.id !== lead.id), total: Math.max(0, d.total - 1) });
        qc.setQueriesData<{ rows: LeadRow[]; total: number }>({ queryKey: ['pipeline', to] }, (d) => d && { rows: [moved, ...d.rows.filter((x) => x.id !== lead.id)], total: d.total + 1 });
      };
      const doc = document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      setPending(null);
      if (doc.startViewTransition && !reduce) {
        flushSync(() => setMoving(lead.id));
        await doc.startViewTransition(() => flushSync(apply)).finished.catch(() => undefined);
        setMoving('');
      } else apply();
      for (const k of [['pipeline'], ['leads'], ['lead', lead.id], ['activities', lead.id]]) qc.invalidateQueries({ queryKey: k });
      toast(`${lead.name} → ${stageLabel(to)}`, 'ok');
    } catch (e) { toast((e as Error).message, 'bad'); setPending(null); }
  }

  return (
    <>
      <PageHead title={t('Pipeline')} sub={t('High-level stage. Temperature is independent of the stage.')} />
      <div className="cmd-strip" style={{ marginBottom: 12 }}>
        <div className="search" style={{ maxWidth: 300, flex: '1 1 220px' }}><Search /><input type="search" placeholder={t('Filter company…')} value={text} onChange={(e) => setText(e.target.value)} aria-label={t('Filter pipeline')} /></div>
        <label className="row small"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> {t('My leads only')}</label>
      </div>
      <ErrorNote error={lanes.find((l) => l.error)?.error} />
      <div className="board" aria-label={t('Pipeline board')}>
        {STAGES.map((s, i) => {
          const r = lanes[i];
          const all = lanes.reduce((n, x) => n + (x.data?.total ?? 0), 0);
          return (
            <div key={s} className={`lane reveal ${dropOn === s ? 'drop' : ''}`} data-stage={s} style={{ ['--i' as string]: i, ['--d' as string]: '60ms' }}
              onDragOver={(e) => { e.preventDefault(); const from = lanes.flatMap((x) => x.data?.rows ?? []).find((x) => x.id === dragId)?.pipeline_stage; setDropOn(from === s ? '' : s); }} onDragLeave={() => setDropOn('')}
              onDrop={(e) => {
                e.preventDefault(); setDropOn(''); setDragId('');
                const id = e.dataTransfer.getData('text/plain');
                const lead = lanes.flatMap((x) => x.data?.rows ?? []).find((x) => x.id === id);
                if (lead && lead.pipeline_stage !== s && canMove(lead)) setPending({ lead, to: s });
              }}>
              <div className="lane-head">
                <div className="lane-title"><span>{stageLabel(s)}</span><span className="badge num">{r.data ? <Num v={r.data.total} count /> : '…'}</span></div>
                <div className="lane-share" aria-hidden="true"><i style={{ width: `${all ? (100 * (r.data?.total ?? 0)) / all : 0}%`, transition: 'width .5s var(--ease-out)' }} /></div>
              </div>
              <div className="lane-body">
                {r.isLoading ? <Loading /> : (r.data?.rows ?? []).map((l) => (
                  <div key={l.id} className={`pcard ${dragId === l.id ? 'dragging' : ''}`} draggable={canMove(l)} data-testid="pipeline-card"
                    style={moving === l.id ? { viewTransitionName: 'moving-lead' } as React.CSSProperties : undefined}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', l.id); e.dataTransfer.effectAllowed = 'move';
                      // pick-up: drag a tilted, raised copy of the card; the original stays as a placeholder
                      const src = e.currentTarget; const ghost = src.cloneNode(true) as HTMLElement;
                      ghost.classList.add('drag-ghost'); ghost.style.width = `${src.offsetWidth}px`; document.body.appendChild(ghost);
                      const r = src.getBoundingClientRect(); e.dataTransfer.setDragImage(ghost, e.clientX - r.left, e.clientY - r.top);
                      setTimeout(() => ghost.remove(), 0);
                      setDragId(l.id);
                    }} onDragEnd={() => { setDragId(''); setDropOn(''); }}>
                    <div className="row nowrap" style={{ gap: 7, alignItems: 'flex-start' }}>
                      <Link to={`/leads/view/?id=${l.id}`} className="pc-name grow" title={l.name}>{l.name}</Link>
                      <TempBadge v={l.temperature} />
                    </div>
                    <div className="pc-meta">
                      {l.last_activity_at && <span title={t('Last activity')}><Clock3 />{fmtRelative(l.last_activity_at)}</span>}
                      {l.next_follow_up_date && <span className={`pc-due ${l.next_follow_up_date < today ? 'over' : ''}`}><CalendarClock />{t('Follow-up {date}', { date: fmtDate(l.next_follow_up_date) })}</span>}
                    </div>
                    {((l.form_status && l.form_status !== 'not_required') || l.proposal_status) && <div className="row small" style={{ gap: 4 }}>
                      {l.form_status && l.form_status !== 'not_required' && <span className="badge">{t('Form')}: {label(FORM_STATUS, l.form_status)}</span>}
                      {l.proposal_status && <span className={`badge p-${l.proposal_status}`}>{t('Proposal')}: {label(PROPOSAL_STATUS, l.proposal_status)}</span>}
                    </div>}
                    {l.suggested_stage && canMove(l) && <button className="btn sm" onClick={() => setPending({ lead: l, to: l.suggested_stage! })}><Sparkles /> {t('Suggest: {stage}', { stage: stageLabel(l.suggested_stage) })}</button>}
                    {canMove(l) && <div className="pc-foot"><Select value={l.pipeline_stage} onChange={(v) => v !== l.pipeline_stage && setPending({ lead: l, to: v })} options={STAGES.map((x) => [x, stageLabel(x)])} /></div>}
                  </div>
                ))}
                {r.data && r.data.total > LANE_LIMIT && <span className="muted small" style={{ padding: 6 }}>{t('Showing {n} of {total}. Use the Leads page to filter by stage.', { n: LANE_LIMIT, total: r.data.total })}</span>}
                {r.data && r.data.total === 0 && <span className="muted small" style={{ padding: 8 }}>{t('No leads')}</span>}
              </div>
            </div>
          );
        })}
      </div>
      {pending && (
        <Modal narrow title={t('Change pipeline stage?')} onClose={() => setPending(null)} footer={<><button className="btn" onClick={() => setPending(null)}>{t('Cancel')}</button><button className="btn primary" onClick={confirmMove} data-testid="confirm-move">{t('Confirm')}</button></>}>
          <p><b>{pending.lead.name}</b>: {stageLabel(pending.lead.pipeline_stage)} → <b>{stageLabel(pending.to)}</b></p>
          <span className="muted small">{t('Stage changes are always explicit and are recorded on the lead\'s timeline and audit log.')}</span>
        </Modal>
      )}
    </>
  );
}
