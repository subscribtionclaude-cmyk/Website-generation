import { t, personName } from '../lib/i18n';
import { term } from '../lib/terminology';
import { Meter } from './viz';

// Team performance — exact values stay readable; bars only add comparison. Neutral palette (no red/green ranking),
// the order is the server's (most call attempts first). Fields that the caller may not see are simply absent.
export interface TeamRow {
  key: string; name?: string; member?: number; active?: boolean;
  total: number; responded: number; did_not_respond: number; unique_leads: number; response_rate: number | null;
  target?: number; achievement_pct?: number | null; remaining?: number;
  meetings_generated: number; proposals_generated: number;
  follow_ups_due?: number; follow_ups_completed?: number; follow_ups_overdue?: number; won?: number; lost?: number;
}

const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v}%`);
export const teamName = (r: TeamRow) => (r.name !== undefined ? personName(r.name) : t('Sales member {n}', { n: r.member ?? '' }));

export function TeamTable({ rows, targets, label, followUps, wl }: { rows: TeamRow[]; targets: boolean; label: string; followUps?: boolean; wl?: boolean }) {
  const maxCalls = Math.max(1, ...rows.map((r) => r.total));
  return (
    <div className="table-wrap sticky-first">
      <table className="t perf" aria-label={label}>
        <thead><tr>
          <th>{term('role_sales')}</th>
          <th>{t('Calls')}</th>
          {targets && <th>{t('Target achievement')}</th>}
          <th>{t('Response rate')}</th>
          <th className="r">{t('Responded')}</th><th className="r">{t("Didn't respond")}</th><th className="r">{t('Unique leads')}</th>
          {targets && <th className="r">{t('Target')}</th>}{targets && <th className="r">{t('Remaining')}</th>}
          <th className="r">{t('Meetings')}</th><th className="r">{t('Proposals')}</th>
          {followUps && <><th className="r">{t('Follow-ups due')}</th><th className="r">{t('Completed')}</th><th className="r">{t('Overdue')}</th></>}
          {wl && <><th className="r">{t('Won')}</th><th className="r">{t('Lost')}</th></>}
        </tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={16} className="muted">{t('No activity in this period.')}</td></tr>}
          {rows.map((r, i) => (
            <tr key={r.key} style={{ ['--i' as string]: i }}>
              <td><span className="who"><span className="rank" aria-hidden="true">{i + 1}</span><span>{teamName(r)}</span>{r.active === false && <span className="badge">{t('inactive')}</span>}</span></td>
              <td><span className="cellbar"><Meter pct={(100 * r.total) / maxCalls} thin label={t('Calls')} delay={300 + i * 32} /><b>{r.total}</b></span></td>
              {targets && <td><span className="cellbar"><Meter pct={r.achievement_pct ?? 0} thin delay={320 + i * 32} /><b>{pct(r.achievement_pct)}</b></span></td>}
              <td><span className="cellbar"><Meter pct={r.response_rate ?? 0} thin label={t('Response rate')} delay={340 + i * 32} /><b>{pct(r.response_rate)}</b></span></td>
              <td className="r num">{r.responded}</td><td className="r num">{r.did_not_respond}</td><td className="r num">{r.unique_leads}</td>
              {targets && <td className="r num">{r.target || '—'}</td>}{targets && <td className="r num">{r.target ? r.remaining : '—'}</td>}
              <td className="r num">{r.meetings_generated}</td><td className="r num">{r.proposals_generated}</td>
              {followUps && <><td className="r num">{r.follow_ups_due ?? 0}</td><td className="r num">{r.follow_ups_completed ?? 0}</td><td className="r num">{r.follow_ups_overdue ?? 0}</td></>}
              {wl && <><td className="r num">{r.won ?? 0}</td><td className="r num">{r.lost ?? 0}</td></>}
            </tr>))}
        </tbody>
      </table>
    </div>
  );
}
