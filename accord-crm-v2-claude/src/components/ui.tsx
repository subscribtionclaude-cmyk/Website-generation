import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X, Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { TEMP_LABEL, STAGE_LABEL } from '../lib/labels';
import type { LeadRow, ProfileLite } from '../lib/types';

export function Spinner() { return <span className="spinner" role="progressbar" aria-label="Loading" />; }
export function Loading({ text = 'Loading…' }: { text?: string }) {
  return <div className="empty"><Spinner /> <span style={{ marginLeft: 8 }}>{text}</span></div>;
}
export function Empty({ children }: { children: ReactNode }) { return <div className="empty">{children}</div>; }
export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return <div className="notice bad" role="alert">{error instanceof Error ? error.message : String(error)}</div>;
}

export function TempBadge({ v }: { v: string }) { return <span className={`badge ${v}`}>{TEMP_LABEL[v] ?? v}</span>; }
export function StageBadge({ v }: { v: string }) { return <span className="badge stage">{STAGE_LABEL[v] ?? v}</span>; }

export function Modal({ title, onClose, children, footer, wide, narrow, side }: {
  title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; narrow?: boolean; side?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input,select,textarea,button.primary')?.focus();
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className={`overlay ${side ? 'right' : ''}`} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`dialog ${wide ? 'wide' : ''} ${narrow ? 'narrow' : ''}`} role="dialog" aria-modal="true" ref={ref}>
        <div className="dialog-head"><h2>{title}</h2><button className="btn ghost icon" onClick={onClose} aria-label="Close"><X /></button></div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, error, full }: { label: string; children: ReactNode; error?: string; full?: boolean }) {
  // the <label> wraps the control, so the text is the control's accessible name (and tapping it focuses the control)
  return <label className={`field ${full ? 'full' : ''}`}><span className="label">{label}</span>{children}{error && <span className="error">{error}</span>}</label>;
}

export function Select({ value, onChange, options, placeholder, disabled }: {
  value: string; onChange: (v: string) => void; options: [string, string][]; placeholder?: string; disabled?: boolean;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
    </select>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: {
  tabs: { key: T; label: string; count?: number | null }[]; value: T; onChange: (k: T) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={value === t.key} className={`tab ${value === t.key ? 'active' : ''}`} onClick={() => onChange(t.key)}>
          {t.label}{t.count !== undefined && t.count !== null && <span className="count num">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="row spread" style={{ padding: '10px 12px' }}>
      <span className="muted small">{total === 0 ? 'No results' : `${page * pageSize + 1}–${Math.min(total, (page + 1) * pageSize)} of ${total}`}</span>
      <div className="row">
        <button className="btn sm" disabled={page === 0} onClick={() => onPage(page - 1)}>Previous</button>
        <span className="muted small">Page {page + 1} / {pages}</span>
        <button className="btn sm" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export function useProfiles() {
  return useQuery({
    queryKey: ['profiles'],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ProfileLite[]> => {
      const { data, error } = await supabase.from('profiles').select('id,full_name,email,role,active').order('full_name');
      if (error) throw new Error(error.message);
      return data as ProfileLite[];
    },
  });
}
export const displayName = (p?: { full_name?: string; email?: string } | null) => (p ? p.full_name || p.email || '—' : '—');

export function UserSelect({ value, onChange, includeAll, allLabel = 'Everyone', onlyBd }: {
  value: string; onChange: (v: string) => void; includeAll?: boolean; allLabel?: string; onlyBd?: boolean;
}) {
  const { data } = useProfiles();
  const list = (data ?? []).filter((p) => p.active && (!onlyBd || p.role === 'bd_executive'));
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="User">
      {includeAll && <option value="">{allLabel}</option>}
      {list.map((p) => <option key={p.id} value={p.id}>{displayName(p)}</option>)}
    </select>
  );
}

/** Type-ahead lead search (bounded: 12 results). */
export function LeadPicker({ onPick, placeholder = 'Search company, contact, phone…', autoFocus }: {
  onPick: (l: Pick<LeadRow, 'id' | 'name'> & Partial<LeadRow>) => void; placeholder?: string; autoFocus?: boolean;
}) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim().toLowerCase(), 250);
  const { data, isFetching } = useQuery({
    queryKey: ['leadPicker', dq], enabled: dq.length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase.from('lead_list_v').select('id,name,external_lead_id,primary_contact,pipeline_stage,temperature')
        .ilike('search_text', `%${dq.replace(/[%_,()]/g, ' ')}%`).eq('archived', false).order('name').limit(12);
      if (error) throw new Error(error.message);
      return data as LeadRow[];
    },
  });
  return (
    <div className="col" style={{ gap: 6 }}>
      <input autoFocus={autoFocus} value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label="Search leads" />
      {isFetching && <span className="muted small">Searching…</span>}
      {data && data.length === 0 && dq.length >= 2 && !isFetching && <span className="muted small">No matching leads.</span>}
      <div className="col" style={{ gap: 4 }}>
        {(data ?? []).map((l) => (
          <button type="button" key={l.id} className="btn" style={{ justifyContent: 'space-between' }} onClick={() => onPick(l)}>
            <span>{l.name}{l.external_lead_id ? <span className="muted small"> · #{l.external_lead_id}</span> : null}</span>
            <span className="muted small">{l.primary_contact ?? ''}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function BusyButton({ busy, children, ...rest }: { busy?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...rest} disabled={busy || rest.disabled}>{busy && <Loader2 className="spin" style={{ animation: 'spin 0.8s linear infinite' }} />}{children}</button>;
}

export function Kpi({ label, value, sub, hero, tone }: { label: string; value: ReactNode; sub?: ReactNode; hero?: boolean; tone?: 'ok' | 'bad' | 'warn' }) {
  return (
    <div className={`card kpi ${hero ? 'hero' : ''}`}>
      <div className="k-label">{label}</div>
      <div className="k-value" style={tone ? { color: `var(--${tone})` } : undefined}>{value}</div>
      {sub !== undefined && <div className="k-sub">{sub}</div>}
    </div>
  );
}
export function PageHead({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return <div className="page-head"><div><h1>{title}</h1>{sub && <div className="sub">{sub}</div>}</div>{actions && <div className="row">{actions}</div>}</div>;
}
