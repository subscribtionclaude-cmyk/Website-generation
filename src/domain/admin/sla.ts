import { isTerminal } from '@/domain/services/status';
import type { ServicePriority, ServiceView, SlaState } from './schemas';

/**
 * Service queue aging, mirroring app.service_sla_state / app.service_view_match. These are
 * internal operating targets for staff (configurable in Settings → Services SLA), never a
 * promise shown to customers.
 */
export interface SlaHours {
  warnHours: number;
  overdueHours: number;
}
export const DEFAULT_SLA_HOURS: SlaHours = { warnHours: 24, overdueHours: 48 };

export interface SlaSubject {
  status: string;
  awaitingCustomer: boolean;
  /** A sent (unanswered) quote / offer / proposal. */
  openOffer: boolean;
  lastChangeAt: string;
}

export function slaState(r: SlaSubject, hours: SlaHours, now: Date): SlaState {
  if (isTerminal(r.status)) return 'closed';
  if (r.awaitingCustomer || r.openOffer) return 'waiting_customer';
  const age = (now.getTime() - new Date(r.lastChangeAt).getTime()) / 3_600_000;
  if (age >= hours.overdueHours) return 'overdue';
  if (age >= hours.warnHours) return 'approaching';
  return 'on_track';
}

export function viewMatches(r: SlaSubject, view: ServiceView): boolean {
  const open = !isTerminal(r.status);
  const waiting = r.awaitingCustomer || r.openOffer;
  switch (view) {
    case 'new':
      return r.status === 'new';
    case 'awaiting':
      return open && waiting;
    case 'in_progress':
      return open && !['new', 'ready'].includes(r.status) && !waiting;
    case 'ready':
      return ['ready', 'reserved', 'approved'].includes(r.status);
    case 'completed':
      return !open;
    case 'open':
      return open;
    default:
      return true;
  }
}

export const PRIORITY_ORDER: Record<ServicePriority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

/** Read SLA hours per kind from the (unvalidated) service_sla setting like the SQL does. */
export function slaHoursFor(setting: unknown, kind: string): SlaHours {
  const entry = (setting as Record<string, Record<string, unknown>> | null)?.[kind];
  const pick = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 9999 ? v : fallback;
  return {
    warnHours: pick(entry?.warnHours, DEFAULT_SLA_HOURS.warnHours),
    overdueHours: pick(entry?.overdueHours, DEFAULT_SLA_HOURS.overdueHours),
  };
}
