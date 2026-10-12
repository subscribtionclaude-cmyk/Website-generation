import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { t } from '../lib/i18n';

// Restrained data-viz + motion primitives for the command-centre UI. Everything renders EXISTING data only — nothing
// here derives new business figures. Motion: CSS for entrances (transform/opacity), rAF count-up for numbers; both are
// skipped under prefers-reduced-motion.

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const ease = (x: number) => 1 - Math.pow(1 - x, 3);

/** Smoothly counts from the previously shown value to the new one (first render counts up from 0). */
export function useCountUp(value: number, ms = 650, delay = 0): number {
  const [shown, setShown] = useState(() => (reduced() ? value : 0));
  const from = useRef(reduced() ? value : 0);
  useEffect(() => {
    if (reduced() || !Number.isFinite(value)) { from.current = value; setShown(value); return; }
    const start = from.current; let raf = 0; let t0 = 0;
    const tick = (now: number) => {
      if (!t0) t0 = now + delay;
      const p = Math.min(1, Math.max(0, (now - t0) / ms));
      const v = start + (value - start) * ease(p);
      from.current = v; setShown(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms, delay]);
  return shown;
}

/** A number that morphs to its new value. Keeps the exact final value in the accessible name. */
export function Num({ v, suffix = '', decimals, delay = 0, locale = true }: { v: number | null | undefined; suffix?: string; decimals?: number; delay?: number; locale?: boolean }) {
  const target = v ?? 0;
  const d = decimals ?? (Number.isInteger(target) ? 0 : 1);
  const shown = useCountUp(target, 650, delay);
  if (v === null || v === undefined) return <>—</>;
  const fmt = (x: number) => (locale ? x.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }) : x.toFixed(d));
  return <span className="num" aria-label={`${fmt(target)}${suffix}`}>{fmt(Math.abs(shown - target) < 1e-9 ? target : shown)}{suffix}</span>;
}

/** Stagger helper: style for the i-th item of a group that starts at `base` ms. */
export const stagger = (i: number, base = 0): CSSProperties => ({ ['--i' as string]: i, ['--d' as string]: `${base}ms` });

/** Progress toward a target; pct may exceed 100 (bar caps, colour turns gold). */
export function Meter({ pct, delay = 300, thin, label }: { pct: number | null | undefined; delay?: number; thin?: boolean; label?: string }) {
  const p = Math.max(0, pct ?? 0);
  return (
    <div className={`meter ${thin ? 'thin' : ''} ${p >= 100 ? 'full' : ''}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p)} aria-label={label ?? t('Target achievement')}
      style={{ ['--d' as string]: `${delay}ms` }}>
      <i style={{ width: `${Math.min(100, p)}%` }} />
    </div>
  );
}

export interface TrendPoint { date: string; total: number; responded?: number; target?: number | null }
/** Calls per day: columns (attempts, responded inset) + responded line + dashed target line. */
export function Trend({ points, fmtX, height = 168, label }: { points: TrendPoint[]; fmtX: (d: string) => string; height?: number; label: string }) {
  const max = Math.max(1, ...points.map((p) => Math.max(p.total, p.target ?? 0)));
  const nice = niceMax(max);
  const n = points.length;
  const x = (i: number) => (n === 1 ? 0.5 : (i + 0.5) / n);
  const y = (v: number) => 1 - v / nice;
  const path = (vals: (number | null | undefined)[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${(x(i) * 100).toFixed(2)},${(y(v ?? 0) * 100).toFixed(2)}`).join(' ');
  const hasTarget = points.some((p) => (p.target ?? 0) > 0);
  const hasResp = points.some((p) => p.responded !== undefined);
  const ticks = [nice, (nice * 3) / 4, nice / 2, nice / 4, 0];
  const labels = n <= 1 ? [points[0]?.date] : [points[0].date, points[Math.floor((n - 1) / 2)].date, points[n - 1].date];
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="trend" role="img" aria-label={label}>
        <div className="y" style={{ height }}>{ticks.map((v, i) => <span key={i}>{v}</span>)}</div>
        <div className="plot" style={{ ['--h' as string]: `${height}px`, ['--gap' as string]: n > 40 ? '1px' : n > 20 ? '2px' : '4px' }}>
          <div className="cols">
            {points.map((p, i) => (
              <div key={p.date} className="col-b" style={{ ['--i' as string]: i }}>
                <i style={{ height: `${(100 * p.total) / nice}%` }}>{p.responded !== undefined && p.total > 0 && <u style={{ height: `${(100 * p.responded) / p.total}%` }} />}</i>
                {(p.target ?? 0) > 0 && <span className="tgt" style={{ bottom: `${(100 * (p.target ?? 0)) / nice}%` }} aria-hidden="true" />}
                <span className="tip">{fmtX(p.date)} · {p.total}{p.responded !== undefined ? ` / ${p.responded}` : ''}{p.target ? ` · ${t('Target')} ${p.target}` : ''}</span>
              </div>))}
          </div>
          {n > 1 && (
            <svg className="line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {hasResp && <path className="resp" pathLength={1} d={path(points.map((p) => p.responded))} />}
            </svg>)}
        </div>
        <div className="x">{labels.map((d, i) => <span key={i}>{d ? fmtX(d) : ''}</span>)}</div>
      </div>
      <div className="legend">
        <span><i className="soft" />{t('Calls')}</span>
        {hasResp && <span><i />{t('Responded')}</span>}
        {hasResp && n > 1 && <span><i className="line" />{t('Responded trend')}</span>}
        {hasTarget && <span><i className="tgt" />{t('Target')}</span>}
      </div>
    </div>
  );
}
/** Axis maximum = 4 × a whole "nice" step (1, 2, 5 × 10ⁿ), so every gridline label is an integer. */
function niceMax(v: number) {
  const raw = Math.max(1, v / 4); const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((m) => m * p).find((x) => x >= raw && Number.isInteger(x)) ?? Math.ceil(raw);
  return step * 4;
}

export interface Segment { key: string; label: ReactNode; value: number; color: string }
/** Stacked distribution bar with a legend of exact values. */
export function MixBar({ items, delay = 320 }: { items: Segment[]; delay?: number }) {
  const total = items.reduce((s, i) => s + i.value, 0);
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="mix" role="img" aria-label={items.map((i) => `${typeof i.label === 'string' ? i.label : i.key} ${i.value}`).join(', ')}>
        {total > 0 && items.filter((i) => i.value > 0).map((i, n) => <i key={i.key} style={{ flexGrow: i.value, background: i.color, ['--i' as string]: n, ['--d' as string]: `${delay}ms` }} />)}
      </div>
      <div className="mix-legend">{items.map((i) => <span key={i.key}><i style={{ background: i.color }} />{i.label}<b>{i.value}</b></span>)}</div>
    </div>
  );
}

/** Donut for a status mix (arcs draw in sequence); centre shows the total. */
export function Donut({ items, centerLabel, delay = 380 }: { items: Segment[]; centerLabel: string; delay?: number }) {
  const total = items.reduce((s, i) => s + i.value, 0);
  const r = 46; const C = 2 * Math.PI * r; let acc = 0;
  return (
    <div className="donut-wrap">
      <div className="donut" role="img" aria-label={`${centerLabel} ${total}`}>
        <svg viewBox="0 0 116 116" aria-hidden="true">
          <circle cx="58" cy="58" r={r} stroke="var(--viz-track)" />
          {total > 0 && items.filter((i) => i.value > 0).map((i, n) => {
            const len = (C * i.value) / total; const gap = items.filter((x) => x.value > 0).length > 1 ? 1.5 : 0;
            const el = <circle key={i.key} className="seg" cx="58" cy="58" r={r} stroke={i.color} strokeDasharray={`${Math.max(0, len - gap)} ${C}`} strokeDashoffset={-acc} style={{ ['--i' as string]: n, ['--d' as string]: `${delay}ms` }} />;
            acc += len; return el;
          })}
        </svg>
        <div className="center"><b><Num v={total} delay={delay} /></b><span>{centerLabel}</span></div>
      </div>
      <div className="mix-legend" style={{ gridTemplateColumns: '1fr' }}>{items.map((i) => <span key={i.key}><i style={{ background: i.color }} />{i.label}<b>{i.value}</b></span>)}</div>
    </div>
  );
}

export interface StageDatum { key: string; label: string; current: number; entered: number }
const STAGE_COLORS = ['var(--viz-2)', 'var(--viz-2)', 'var(--viz-1)', 'var(--viz-1)', 'var(--viz-1)', 'var(--viz-1)', 'var(--viz-3)', 'var(--viz-4)'];
const STAGE_ALPHA = [0.45, 0.7, 0.55, 0.7, 0.85, 1, 1, 1];
/** Pipeline distribution: one stacked strip + per-stage rows (current snapshot, share, entered during the period). */
export function StageFlow({ stages, delay = 300 }: { stages: StageDatum[]; delay?: number }) {
  const total = stages.reduce((s, x) => s + x.current, 0);
  const max = Math.max(1, ...stages.map((s) => s.current));
  const color = (i: number) => STAGE_COLORS[i] ?? 'var(--viz-1)';
  return (
    <div className="stageflow">
      <div className="sf-strip" role="img" aria-label={stages.map((s) => `${s.label} ${s.current}`).join(', ')}>
        {total > 0 && stages.map((s, i) => s.current > 0 && <i key={s.key} title={`${s.label}: ${s.current}`} style={{ flexGrow: s.current, background: color(i), opacity: STAGE_ALPHA[i] ?? 1, ['--i' as string]: i, ['--d' as string]: `${delay}ms` }} />)}
      </div>
      <div className="sf-row sf-head" aria-hidden="true"><span /><span /><span style={{ textAlign: 'end' }}>{t('Now')}</span><span style={{ textAlign: 'end' }}>{t('Share')}</span><span className="ent">{t('In period')}</span></div>
      {stages.map((s, i) => (
        <div key={s.key} className="sf-row">
          <span className="lbl"><i style={{ background: color(i), opacity: STAGE_ALPHA[i] ?? 1 }} />{s.label}</span>
          <span className="track"><i style={{ width: `${(100 * s.current) / max}%`, background: color(i), opacity: STAGE_ALPHA[i] ?? 1, ['--i' as string]: i, ['--d' as string]: `${delay}ms` }} /></span>
          <b><Num v={s.current} delay={delay} /></b>
          <span className="pct">{total ? `${Math.round((100 * s.current) / total)}%` : '—'}</span>
          <span className={`ent ${s.entered > 0 ? 'pos' : ''}`}>{s.entered > 0 ? `+${s.entered}` : '0'}</span>
        </div>))}
    </div>
  );
}

/** Panel: a single plane with an optional header (title, subtitle, actions). */
export function Panel({ title, sub, actions, children, className = '', style, flush, testId, label }: {
  title?: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; style?: CSSProperties; flush?: boolean; testId?: string; label?: string;
}) {
  return (
    <section className={`panel ${className}`} style={style} data-testid={testId} aria-label={label}>
      {(title || actions) && <div className="panel-head"><div className="col" style={{ gap: 1 }}>{title && <h2>{title}</h2>}{sub && <span className="ph-sub">{sub}</span>}</div>{actions}</div>}
      <div className={`panel-body ${flush ? 'flush' : ''}`}>{children}</div>
    </section>
  );
}

/** Meetings in the period as two honest partitions: confirmation (of meetings held or planned) and outcome. */
export function MeetingMix({ m }: { m: Record<string, number> }) {
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="col" style={{ gap: 6 }}><span className="muted small">{t('Confirmation')}</span>
        <MixBar delay={420} items={[{ key: 'c', label: t('Confirmed'), value: m.confirmed ?? 0, color: 'var(--viz-2)' }, { key: 'u', label: t('Unconfirmed'), value: m.unconfirmed ?? 0, color: 'var(--viz-4)' }]} /></div>
      <div className="col" style={{ gap: 6 }}><span className="muted small">{t('Outcome')}</span>
        <MixBar delay={480} items={[
          { key: 'a', label: t('Attended'), value: m.attended ?? 0, color: 'var(--viz-1)' }, { key: 'n', label: t('Not attended'), value: m.not_attended ?? 0, color: 'var(--line-strong)' },
          { key: 'w', label: t('Awaiting outcome'), value: m.awaiting_outcome ?? 0, color: 'var(--viz-3)' }, { key: 'r', label: t('Rescheduled'), value: m.rescheduled ?? 0, color: 'var(--viz-2)' },
          { key: 'x', label: t('Cancelled'), value: m.cancelled ?? 0, color: 'var(--subtle)' }]} /></div>
    </div>
  );
}
