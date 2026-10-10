import { supabase } from './supabase';
import { t } from './i18n';
import { addDays, cairoDayStart, cairoToday, fmtDateTime, monthRange, weekRange } from './cairo';
import {
  label, CONFIRMATION, FORM_STATUS, MEETING_OUTCOMES, MEETING_TYPES, NEXT_STEPS, NOT_ATTENDED_REASONS, NO_RESPONSE_SUBS,
  OUTCOME_LABEL, PROPOSAL_STATUS, RESPONDED_SUBS, RESPONSE_OUTCOME, RESPONSE_STATE, STAGE_LABEL, TEMP_LABEL, proposalCode,
} from './labels';
import { computeMilestones } from './milestones';
import { activityText } from './activityText';
import type { Sheet, Cell } from './xlsx';
import type { LeadRow } from './types';

// CRM data export. Every read uses the signed-in user's own session, so Row Level Security decides what can be
// exported (nothing is fetched with elevated rights). Each table is read in pages of 1000 rows (one request per page).

export type DatasetKey = 'leads' | 'contacts' | 'calls' | 'followups' | 'meetings' | 'minutes' | 'forms' | 'proposals' | 'pipeline' | 'activities' | 'projects';
export const DATASETS: { key: DatasetKey; label: string }[] = [
  { key: 'leads', label: 'Leads' }, { key: 'contacts', label: 'Contacts' }, { key: 'calls', label: 'Calls' },
  { key: 'followups', label: 'Follow-Ups' }, { key: 'meetings', label: 'Meetings' }, { key: 'minutes', label: 'Meeting Minutes' },
  { key: 'forms', label: 'Forms' }, { key: 'proposals', label: 'Proposals' }, { key: 'pipeline', label: 'Pipeline' },
  { key: 'activities', label: 'Activities' }, { key: 'projects', label: 'Projects' },
];

export type PeriodKind = 'all' | 'today' | 'this_week' | 'this_month' | 'custom';
export interface Period { kind: PeriodKind; from?: string; to?: string }
export interface Filters { owner?: string; temperature?: string; stage?: string; leadStatus?: '' | 'active' | 'archived'; proposalStatus?: string; meetingStatus?: string }

/** Resolve a period to Cairo calendar dates (inclusive). `null` = all time. */
export function resolvePeriod(p: Period, today = cairoToday()): { from: string; to: string } | null {
  switch (p.kind) {
    case 'all': return null;
    case 'today': return { from: today, to: today };
    case 'this_week': return weekRange(today);
    case 'this_month': return monthRange(today);
    default: return p.from && p.to ? (p.from <= p.to ? { from: p.from, to: p.to } : { from: p.to, to: p.from }) : null;
  }
}
/** Instant bounds for timestamp columns: [Cairo 00:00 of from, Cairo 00:00 of the day after to). */
export const instantBounds = (r: { from: string; to: string }) => ({ gte: cairoDayStart(r.from).toISOString(), lt: cairoDayStart(addDays(r.to, 1)).toISOString() });

const PAGE = 1000;
type Q = { range: (a: number, b: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }> };
async function fetchAll<T>(build: () => Q): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) return out;
  }
}

const dt = (iso?: string | null) => (iso ? fmtDateTime(iso) : '');
const d = (v?: string | null) => v ?? '';
const yes = (b?: boolean | null) => (b === null || b === undefined ? '' : b ? t('Yes') : t('No'));
const SOURCE: Record<string, string> = { manual: 'Manual', google_sheet: 'Google Sheet import', import: 'Import' };
const flat = (o: Record<string, unknown> | null | undefined) => (o ? Object.entries(o).filter(([, v]) => v !== null && v !== '' && v !== undefined).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join('; ') : '');
const lbl = (m: [string, string][] | Record<string, string>, k?: string | null) => (k ? label(m, k) : '');

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;
export interface ExportData {
  leads: (LeadRow & Row)[]; leadExtra: Map<string, Row>; contacts: Row[]; calls: Row[]; followups: Row[]; meetings: Row[];
  forms: Row[]; proposals: Row[]; activities: Row[]; projects: Row[]; people: Map<string, string>; outcomeKind: Map<string, string>;
  activityTypes: Map<string, string>;
}

/** Fetch what the selected datasets need, applying period + filters. */
export async function fetchExportData(sets: DatasetKey[], period: Period, f: Filters, onStep?: (s: string) => void): Promise<ExportData> {
  const r = resolvePeriod(period); const b = r ? instantBounds(r) : null;
  const need = (...k: DatasetKey[]) => k.some((x) => sets.includes(x));
  const step = (s: string) => onStep?.(t(s));

  step('Reading users…');
  const [people, outcomes, types] = await Promise.all([
    fetchAll<Row>(() => supabase.from('profiles').select('id,full_name,email').order('id') as unknown as Q),
    fetchAll<Row>(() => supabase.from('call_outcomes').select('key,kind').order('key') as unknown as Q),
    fetchAll<Row>(() => supabase.from('activity_types').select('key,label').order('key') as unknown as Q),
  ]);
  const P = new Map(people.map((p) => [p.id as string, (p.full_name as string) || (p.email as string)]));

  step('Reading leads…');
  const leads = await fetchAll<LeadRow & Row>(() => {
    let q: any = supabase.from('lead_list_v').select('*').order('name').order('id');
    if (f.temperature) q = q.eq('temperature', f.temperature);
    if (f.stage) q = q.eq('pipeline_stage', f.stage);
    if (f.leadStatus === 'active') q = q.eq('archived', false); else if (f.leadStatus === 'archived') q = q.eq('archived', true);
    return q;
  });
  const leadExtra = new Map<string, Row>();
  if (need('leads')) {
    const extra = await fetchAll<Row>(() => supabase.from('leads').select('id,website,address,notes').order('id') as unknown as Q);
    for (const x of extra) leadExtra.set(x.id, x);
  }
  // lead-level filters restrict every child dataset to the same set of leads
  const leadFilter = Boolean(f.temperature || f.stage || f.leadStatus);
  const ids = new Set(leads.map((l) => l.id));
  const keep = <T extends Row>(rows: T[]) => (leadFilter ? rows.filter((x) => ids.has(x.lead_id)) : rows);
  const own = (q: any, col: string) => (f.owner ? q.eq(col, f.owner) : q);
  const inRange = (q: any, col: string, isDate = false) => (!r ? q : isDate ? q.gte(col, r.from).lte(col, r.to) : q.gte(col, b!.gte).lt(col, b!.lt));

  const tasks: Promise<void>[] = [];
  const out: Partial<ExportData> = {};
  const lead = 'leads(name,external_lead_id)';
  if (need('contacts', 'leads')) tasks.push(fetchAll<Row>(() => (need('contacts') ? inRange(supabase.from('contacts').select(`*, ${lead}`), 'created_at') : supabase.from('contacts').select(`*, ${lead}`)).order('created_at').order('id')).then((x) => { out.contacts = keep(x); }));
  if (need('calls')) tasks.push(fetchAll<Row>(() => own(inRange(supabase.from('call_attempts').select(`*, ${lead}`), 'called_at'), 'user_id').order('called_at').order('id')).then((x) => { out.calls = keep(x); }));
  if (need('followups', 'calls')) tasks.push(fetchAll<Row>(() => own(need('followups') ? inRange(supabase.from('follow_ups').select(`*, ${lead}`), 'due_date', true) : supabase.from('follow_ups').select(`*, ${lead}`), 'owner_id').order('due_date').order('id')).then((x) => { out.followups = keep(x); }));
  if (need('meetings', 'minutes', 'forms', 'proposals', 'leads')) tasks.push(fetchAll<Row>(() => {
    let q: any = supabase.from('meetings').select(`*, ${lead}`);
    if (need('meetings', 'minutes')) q = inRange(q, 'scheduled_at');
    if (f.meetingStatus) q = q.eq('status', f.meetingStatus);
    return own(q, 'owner_id').order('scheduled_at', { nullsFirst: true }).order('id');
  }).then((x) => { out.meetings = keep(x); }));
  if (need('forms', 'proposals')) tasks.push(fetchAll<Row>(() => own(inRange(supabase.from('commercial_forms').select(`*, ${lead}`), 'created_at'), 'owner_id').order('created_at').order('id')).then((x) => { out.forms = keep(x); }));
  if (need('proposals')) tasks.push(fetchAll<Row>(() => {
    let q: any = inRange(supabase.from('proposals').select(`*, ${lead}`), 'created_at');
    if (f.proposalStatus) q = q.eq('status', f.proposalStatus);
    return own(q, 'owner_id').order('proposal_no');
  }).then((x) => { out.proposals = keep(x); }));
  if (need('activities')) tasks.push(fetchAll<Row>(() => own(inRange(supabase.from('activities').select(`*, ${lead}`), 'occurred_at'), 'actor_id').order('occurred_at').order('seq')).then((x) => { out.activities = keep(x); }));
  if (need('projects')) tasks.push(fetchAll<Row>(() => inRange(supabase.from('projects').select('*, leads:linked_lead_id(name)'), 'created_at').order('developer_name').order('project_name')).then((x) => { out.projects = x; }));
  step('Reading CRM records…');
  await Promise.all(tasks);
  return {
    leads: r && need('leads') ? leads.filter((l) => l.created_at >= b!.gte && l.created_at < b!.lt) : leads,
    leadExtra, contacts: out.contacts ?? [], calls: out.calls ?? [], followups: out.followups ?? [], meetings: out.meetings ?? [],
    forms: out.forms ?? [], proposals: out.proposals ?? [], activities: out.activities ?? [], projects: out.projects ?? [],
    people: P, outcomeKind: new Map(outcomes.map((o) => [o.key, o.kind])), activityTypes: new Map(types.map((x) => [x.key, x.label])),
  };
}

const company = (x: Row) => x.leads?.name ?? '';
const leadNo = (x: Row) => x.leads?.external_lead_id ?? '';

/** Turn fetched data into worksheets (headers + values in the current UI language). */
export function buildSheets(sets: DatasetKey[], D: ExportData): Sheet[] {
  const who = (id?: string | null) => (id ? D.people.get(id) ?? '' : '');
  const meetingById = new Map(D.meetings.map((m) => [m.id, m]));
  const formById = new Map(D.forms.map((m) => [m.id, m]));
  const fuByCall = new Map(D.followups.filter((x) => x.call_id).map((x) => [x.call_id, x]));
  const primary = new Map<string, Row>();
  for (const c of D.contacts) if (!primary.has(c.lead_id) || c.is_primary) primary.set(c.lead_id, c);
  const lastStep = new Map<string, Row>();
  for (const m of D.meetings) if (m.next_step && (!lastStep.has(m.lead_id) || (m.scheduled_at ?? '') > (lastStep.get(m.lead_id)!.scheduled_at ?? ''))) lastStep.set(m.lead_id, m);
  const mDate = (id?: string | null) => (id && meetingById.get(id) ? dt(meetingById.get(id)!.scheduled_at) || t('Date not set yet') : '');
  const H = (...h: string[]) => h.map((x) => t(x));
  const milestoneNow = (l: LeadRow) => {
    const ms = computeMilestones(l); const cur = [...ms].reverse().find((m) => m.state === 'done' || m.state === 'active') ?? ms[0];
    return `${t(cur.label)} — ${t(cur.text)}`;
  };
  const sheets: Record<DatasetKey, () => Sheet> = {
    leads: () => ({ name: t('Leads'), header: H('Lead ID', 'Company', 'Primary contact', 'Email', 'Phone', 'Lead source', 'Temperature', 'Pipeline stage', 'Status', 'Next step', 'Next follow-up', 'Last activity', 'Total calls', 'Responded', 'Last call', 'Last call outcome', 'Next meeting', 'Form status', 'Proposal status', 'Current milestone', 'Assigned user', 'City', 'Industry', 'Website', 'Notes', 'Legacy sheet data', 'Created', 'Updated'),
      rows: D.leads.map((l) => { const c = primary.get(l.id); const x = D.leadExtra.get(l.id) ?? {}; const s = lastStep.get(l.id); return [
        l.external_lead_id, l.name, l.primary_contact ?? c?.full_name, (c?.emails ?? []).join('; '), (c?.phones ?? []).join('; '), t(SOURCE[l.source] ?? l.source),
        TEMP_LABEL[l.temperature] ?? l.temperature, STAGE_LABEL[l.pipeline_stage] ?? l.pipeline_stage, l.archived ? t('Archived') : t('Active'),
        s ? `${lbl(NEXT_STEPS, s.next_step)}${s.next_step_detail ? ` — ${s.next_step_detail}` : ''}` : '', d(l.next_follow_up_date), dt(l.last_activity_at),
        l.total_calls ?? 0, l.responded_calls ?? 0, dt(l.last_call_at), lbl(OUTCOME_LABEL, l.last_call_outcome), dt(l.next_meeting_at),
        lbl(FORM_STATUS, l.form_status), lbl(PROPOSAL_STATUS, l.proposal_status), milestoneNow(l), l.owner_name ?? '', l.city, l.industry, x.website, x.notes,
        flat(l.legacy), dt(l.created_at), dt(l.updated_at)] as Cell[]; }) }),
    contacts: () => ({ name: t('Contacts'), header: H('Company', 'Lead ID', 'Name', 'Job title', 'Emails', 'Phones', 'LinkedIn', 'Primary', 'Notes', 'Created'),
      rows: D.contacts.map((c) => [company(c), leadNo(c), c.full_name, c.job_title, (c.emails ?? []).join('; '), (c.phones ?? []).join('; '), (c.linkedin ?? []).join('; '), yes(c.is_primary), c.notes, dt(c.created_at)]) }),
    calls: () => ({ name: t('Calls'), header: H('Date & time (Cairo)', 'Lead ID', 'Company', 'User', 'Outcome', 'Result', 'Detail', 'Notes', 'Follow-up date', 'Meeting created', 'Duration (s)'),
      rows: D.calls.map((c) => { const fu = fuByCall.get(c.id); return [dt(c.called_at), leadNo(c), company(c), who(c.user_id), lbl(OUTCOME_LABEL, c.outcome),
        D.outcomeKind.get(c.outcome) === 'responded' ? t('Responded') : t("Didn't respond"), lbl([...RESPONDED_SUBS, ...NO_RESPONSE_SUBS], c.sub_outcome), c.notes,
        fu ? fu.due_date : '', yes(Boolean(c.meeting_id)), c.duration_seconds] as Cell[]; }) }),
    followups: () => ({ name: t('Follow-Ups'), header: H('Due date', 'Due time', 'Company', 'Lead ID', 'Title', 'Notes', 'Status', 'Origin', 'Owner', 'Completed at', 'Created'),
      rows: D.followups.map((x) => [x.due_date, x.due_time ? String(x.due_time).slice(0, 5) : '', company(x), leadNo(x), x.title, x.notes, t(x.status === 'open' ? 'Open (decision)' : x.status === 'completed' ? 'Completed' : 'Cancelled'), t(String(x.origin).replace(/_/g, ' ')), who(x.owner_id), dt(x.completed_at), dt(x.created_at)]) }),
    meetings: () => ({ name: t('Meetings'), header: H('Scheduled (Cairo)', 'Company', 'Lead ID', 'Meeting type', 'Status', 'Confirmation', 'Attendance', 'Not-attended reason', 'Meeting with', 'Purpose', 'Location / link', 'Owner', 'Outcome', 'Next step', 'Next step detail', 'Next follow-up', 'Replacement for', 'Follow-up to', 'Next meeting', 'Created from call', 'Created'),
      rows: D.meetings.map((m) => [dt(m.scheduled_at) || t('Date not set yet'), company(m), leadNo(m), lbl(MEETING_TYPES, m.meeting_type), lbl(MEETING_STATUS, m.status), lbl(CONFIRMATION, m.confirmation_status),
        lbl(ATTENDANCE, m.attendance_status), lbl(NOT_ATTENDED_REASONS, m.not_attended_reason), m.meeting_with, m.purpose, m.online_link || m.location, who(m.owner_id),
        lbl(MEETING_OUTCOMES, m.meeting_outcome), lbl(NEXT_STEPS, m.next_step), m.next_step_detail, d(m.next_follow_up_at), mDate(m.rescheduled_from_id), mDate(m.follows_meeting_id), mDate(m.next_meeting_id), yes(Boolean(m.created_from_call_id)), dt(m.created_at)]) }),
    minutes: () => ({ name: t('Meeting Minutes'), header: H('Scheduled (Cairo)', 'Company', 'Meeting with', 'Meeting summary', 'Minutes of meeting', 'Client requirements', 'Discussion points', 'Agreements', 'Commitments', 'Requested documents', 'Commercial notes', 'Outcome', 'Next step'),
      rows: D.meetings.filter((m) => m.minutes_of_meeting || m.summary).map((m) => [dt(m.scheduled_at), company(m), m.meeting_with, m.summary, m.minutes_of_meeting, m.client_requirements, m.discussion_points, m.agreements, m.commitments, m.requested_documents, m.commercial_notes, lbl(MEETING_OUTCOMES, m.meeting_outcome), lbl(NEXT_STEPS, m.next_step)]) }),
    forms: () => ({ name: t('Forms'), header: H('Company', 'Lead ID', 'Status', 'Required', 'Date sent', 'Date completed', 'Form link', 'Notes', 'Owner', 'Linked meeting', 'Created'),
      rows: D.forms.map((x) => [company(x), leadNo(x), lbl(FORM_STATUS, x.status), yes(x.required), d(x.sent_on), d(x.completed_on), x.link, x.notes, who(x.owner_id), mDate(x.meeting_id), dt(x.created_at)]) }),
    proposals: () => ({ name: t('Proposals'), header: H('Proposal', 'Company', 'Lead ID', 'Title', 'Status', 'Value', 'Currency', 'Prepared date', 'Sent date', 'Client response', 'Response', 'Date of response', 'Response notes', 'Decision', 'Next follow-up', 'Linked meeting', 'Linked information form', 'Owner', 'Created'),
      rows: D.proposals.map((p) => [proposalCode(p.proposal_no), company(p), leadNo(p), p.title, lbl(PROPOSAL_STATUS, p.status), p.value === null ? '' : Number(p.value), p.currency, d(p.prepared_on), d(p.sent_on),
        lbl(RESPONSE_STATE, p.response_state), lbl(RESPONSE_OUTCOME, p.response_outcome), d(p.response_on), p.response_notes,
        ['accepted', 'rejected', 'closed'].includes(p.status) ? lbl(PROPOSAL_STATUS, p.status) : '', d(p.next_follow_up_date), mDate(p.meeting_id),
        p.form_id && formById.get(p.form_id) ? lbl(FORM_STATUS, formById.get(p.form_id)!.status) : '', who(p.owner_id), dt(p.created_at)]) }),
    pipeline: () => ({ name: t('Pipeline'), header: H('Company', 'Lead ID', 'Pipeline stage', 'Temperature', 'Suggested stage', 'Assigned user', 'CONTACT', 'CALL', 'MEETING', 'FORM', 'PROPOSAL', 'RESPONSE', 'NEGOTIATION', 'DECISION'),
      rows: D.leads.map((l) => [l.name, l.external_lead_id, STAGE_LABEL[l.pipeline_stage] ?? l.pipeline_stage, TEMP_LABEL[l.temperature] ?? l.temperature, l.suggested_stage ? STAGE_LABEL[l.suggested_stage] : '', l.owner_name ?? '',
        ...computeMilestones(l).map((m) => t(m.text))]) }),
    activities: () => ({ name: t('Activities'), header: H('Date & time (Cairo)', 'Company', 'Lead ID', 'Type', 'Summary', 'By'),
      rows: D.activities.map((a) => [dt(a.occurred_at), company(a), leadNo(a), t(D.activityTypes.get(a.type) ?? a.type), activityText(a.summary, a.type), who(a.actor_id)]) }),
    projects: () => ({ name: t('Projects'), header: H('Developer', 'Project', 'Linked lead', 'Details', 'Source sheet', 'Source row', 'Created'),
      rows: D.projects.map((p) => [p.developer_name, p.project_name, p.leads?.name ?? '', flat(p.attributes), p.source_sheet, p.source_row, dt(p.created_at)]) }),
  };
  return sets.map((k) => sheets[k]());
}

const MEETING_STATUS: [string, string][] = [['requested', 'Requested'], ['scheduled', 'Scheduled'], ['completed', 'Completed'], ['missed', 'Missed'], ['cancelled', 'Cancelled'], ['rescheduled', 'Rescheduled']];
const ATTENDANCE: [string, string][] = [['pending', 'Pending'], ['attended', 'Attended'], ['not_attended', 'Not Attended']];
export const MEETING_STATUS_OPTIONS = MEETING_STATUS;

export function exportFileName(kind: 'full' | DatasetKey, period: Period, today = cairoToday()): string {
  const r = resolvePeriod(period, today);
  const span = r ? (r.from === r.to ? `_${r.from}` : `_${r.from}_to_${r.to}`) : '';
  if (kind === 'full') return `ACCORD_CRM_FULL_EXPORT_${today}${span && span !== `_${today}` ? `__period${span}` : ''}.xlsx`;
  const name = DATASETS.find((x) => x.key === kind)!.label.replace(/[^A-Za-z]+/g, '_');
  return `ACCORD_CRM_${name}_${today}${span && span !== `_${today}` ? `__period${span}` : ''}.xlsx`;
}
