// Compact operational milestones for a lead. They sit beside (never replace) the high-level pipeline stage.
export type MsState = 'done' | 'active' | 'pending' | 'warn' | 'bad';
export interface Milestone { key: string; label: string; state: MsState; text: string }

interface Roll {
  contacts_count?: number | null; total_calls?: number | null; responded_calls?: number | null;
  meetings_total?: number | null; meetings_attended?: number | null; next_meeting_at?: string | null;
  form_status?: string | null; proposal_status?: string | null; proposal_response?: string | null;
  negotiation_recorded?: boolean | null; pipeline_stage?: string | null;
}

export function computeMilestones(r: Roll): Milestone[] {
  const out: Milestone[] = [];
  out.push({ key: 'contact', label: 'CONTACT', state: (r.contacts_count ?? 0) > 0 ? 'done' : 'warn', text: (r.contacts_count ?? 0) > 0 ? `${r.contacts_count} on file` : 'No contact' });
  const calls = r.total_calls ?? 0; const resp = r.responded_calls ?? 0;
  out.push({ key: 'call', label: 'CALL', state: resp > 0 ? 'done' : calls > 0 ? 'active' : 'pending', text: resp > 0 ? 'Connected' : calls > 0 ? `${calls} no response` : 'Not called' });
  const mt = r.meetings_attended ?? 0;
  out.push({ key: 'meeting', label: 'MEETING', state: mt > 0 ? 'done' : r.next_meeting_at || (r.meetings_total ?? 0) > 0 ? 'active' : 'pending', text: mt > 0 ? `${mt} attended` : r.next_meeting_at ? 'Scheduled' : (r.meetings_total ?? 0) > 0 ? 'Pending outcome' : 'None' });
  const f = r.form_status;
  out.push({ key: 'form', label: 'FORM', state: f === 'completed' ? 'done' : f === 'sent' || f === 'partially_completed' ? 'active' : f === 'not_required' ? 'done' : f ? 'warn' : 'pending',
    text: !f ? 'None' : ({ not_required: 'Not required', not_sent: 'Not sent', sent: 'Awaiting client', partially_completed: 'Partial', completed: 'Completed' } as Record<string, string>)[f] ?? f });
  const p = r.proposal_status;
  const pdone = p && ['sent', 'under_review', 'revision_requested', 'accepted', 'rejected', 'closed'].includes(p);
  out.push({ key: 'proposal', label: 'PROPOSAL', state: pdone ? 'done' : p ? 'active' : 'pending',
    text: !p ? 'None' : p.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) });
  const resp2 = r.proposal_response;
  out.push({ key: 'response', label: 'RESPONSE', state: resp2 && !['awaiting_response', 'no_response_yet'].includes(resp2) ? 'done' : pdone ? 'active' : 'pending',
    text: !resp2 ? '—' : resp2 === 'awaiting_response' ? 'Awaiting' : resp2 === 'no_response_yet' ? 'None yet' : resp2.replace(/_/g, ' ') });
  out.push({ key: 'negotiation', label: 'NEGOTIATION', state: r.negotiation_recorded ? 'active' : 'pending', text: r.negotiation_recorded ? 'In progress' : '—' });
  const st = r.pipeline_stage;
  out.push({ key: 'decision', label: 'DECISION', state: st === 'won' ? 'done' : st === 'lost' ? 'bad' : 'pending', text: st === 'won' ? 'Won' : st === 'lost' ? 'Lost' : 'Open' });
  return out;
}
