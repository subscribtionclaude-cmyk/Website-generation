import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { supabase, unwrap } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { PageHead, TempBadge, Loading, ErrorNote, Modal, Select, useDebounced } from '../components/ui';
import { STAGES, STAGE_LABEL, FORM_STATUS, PROPOSAL_STATUS, label } from '../lib/labels';
import { fmtDate, cairoToday } from '../lib/cairo';
import type { LeadRow } from '../lib/types';

const LANE_LIMIT = 40;

export default function Pipeline() {
  const { profile, isStaff, isAdmin } = useAuth();
  const qc = useQueryClient(); const toast = useToast();
  const [mine, setMine] = useState(false);
  const [text, setText] = useState(''); const q = useDebounced(text.trim().toLowerCase());
  const [pending, setPending] = useState<{ lead: LeadRow; to: string } | null>(null);
  const [dropOn, setDropOn] = useState('');
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
  const stageLabel = (k: string) => stages.data?.find((s) => s.key === k)?.label ?? STAGE_LABEL[k];

  const canMove = (l: LeadRow) => isAdmin || (isStaff && (l.owner_id === null || l.owner_id === profile?.id));
  async function confirmMove() {
    if (!pending) return;
    try {
      unwrap(await supabase.from('leads').update({ pipeline_stage: pending.to }).eq('id', pending.lead.id).select('id'));
      for (const k of [['pipeline'], ['leads'], ['lead', pending.lead.id], ['activities', pending.lead.id]]) qc.invalidateQueries({ queryKey: k });
      toast(`${pending.lead.name} → ${stageLabel(pending.to)}`, 'ok');
    } catch (e) { toast((e as Error).message, 'bad'); }
    setPending(null);
  }

  return (
    <>
      <PageHead title="Pipeline" sub="High-level stage. Temperature is independent of the stage." />
      <div className="row" style={{ marginBottom: 12 }}>
        <input placeholder="Filter company…" value={text} onChange={(e) => setText(e.target.value)} style={{ maxWidth: 260 }} aria-label="Filter pipeline" />
        <label className="row small"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> My leads only</label>
      </div>
      <ErrorNote error={lanes.find((l) => l.error)?.error} />
      <div className="board" aria-label="Pipeline board">
        {STAGES.map((s, i) => {
          const r = lanes[i];
          return (
            <div key={s} className={`lane ${dropOn === s ? 'drop' : ''}`} data-stage={s}
              onDragOver={(e) => { e.preventDefault(); setDropOn(s); }} onDragLeave={() => setDropOn('')}
              onDrop={(e) => {
                e.preventDefault(); setDropOn('');
                const id = e.dataTransfer.getData('text/plain');
                const lead = lanes.flatMap((x) => x.data?.rows ?? []).find((x) => x.id === id);
                if (lead && lead.pipeline_stage !== s && canMove(lead)) setPending({ lead, to: s });
              }}>
              <div className="lane-head"><span>{stageLabel(s)}</span><span className="badge num">{r.data?.total ?? '…'}</span></div>
              <div className="lane-body">
                {r.isLoading ? <Loading /> : (r.data?.rows ?? []).map((l) => (
                  <div key={l.id} className="pcard" draggable={canMove(l)} onDragStart={(e) => e.dataTransfer.setData('text/plain', l.id)} data-testid="pipeline-card">
                    <div className="row spread nowrap"><Link to={`/leads/view/?id=${l.id}`}><b>{l.name}</b></Link><TempBadge v={l.temperature} /></div>
                    <div className="row small muted">
                      {l.form_status && l.form_status !== 'not_required' && <span className="badge">Form: {label(FORM_STATUS, l.form_status)}</span>}
                      {l.proposal_status && <span className="badge">Proposal: {label(PROPOSAL_STATUS, l.proposal_status)}</span>}
                    </div>
                    {l.next_follow_up_date && <span className="small" style={{ color: l.next_follow_up_date < today ? 'var(--bad)' : undefined }}>Follow-up {fmtDate(l.next_follow_up_date)}</span>}
                    {l.suggested_stage && canMove(l) && <button className="btn sm" onClick={() => setPending({ lead: l, to: l.suggested_stage! })}><Sparkles /> Suggest: {STAGE_LABEL[l.suggested_stage]}</button>}
                    {canMove(l) && <Select value={l.pipeline_stage} onChange={(v) => v !== l.pipeline_stage && setPending({ lead: l, to: v })} options={STAGES.map((x) => [x, stageLabel(x)])} />}
                  </div>
                ))}
                {r.data && r.data.total > LANE_LIMIT && <span className="muted small" style={{ padding: 6 }}>Showing {LANE_LIMIT} of {r.data.total}. Use the Leads page to filter by stage.</span>}
                {r.data && r.data.total === 0 && <span className="muted small" style={{ padding: 8 }}>No leads</span>}
              </div>
            </div>
          );
        })}
      </div>
      {pending && (
        <Modal narrow title="Change pipeline stage?" onClose={() => setPending(null)} footer={<><button className="btn" onClick={() => setPending(null)}>Cancel</button><button className="btn primary" onClick={confirmMove} data-testid="confirm-move">Confirm</button></>}>
          <p><b>{pending.lead.name}</b>: {stageLabel(pending.lead.pipeline_stage)} → <b>{stageLabel(pending.to)}</b></p>
          <span className="muted small">Stage changes are always explicit and are recorded on the lead's timeline and audit log.</span>
        </Modal>
      )}
    </>
  );
}
