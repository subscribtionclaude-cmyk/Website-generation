export interface CallMetrics {
  total: number; responded: number; did_not_respond: number; unique_leads: number;
  response_rate: number | null; target: number; has_target: boolean; achievement_pct: number | null; remaining: number;
}
/** Achievement is never capped at 100%. */
export function achievement(total: number, target: number): number | null {
  return target > 0 ? Math.round((1000 * total) / target) / 10 : null;
}
export function remaining(total: number, target: number): number { return Math.max(target - total, 0); }
export function responseRate(responded: number, total: number): number | null {
  return total > 0 ? Math.round((1000 * responded) / total) / 10 : null;
}
/** Optimistic local update after a call is logged (rolled back by the caller on failure). */
export function applyCall(m: CallMetrics, kind: 'responded' | 'did_not_respond', newLead: boolean): CallMetrics {
  const total = m.total + 1;
  const responded = m.responded + (kind === 'responded' ? 1 : 0);
  return {
    ...m, total, responded, did_not_respond: total - responded, unique_leads: m.unique_leads + (newLead ? 1 : 0),
    response_rate: responseRate(responded, total), achievement_pct: achievement(total, m.target), remaining: remaining(total, m.target),
  };
}
