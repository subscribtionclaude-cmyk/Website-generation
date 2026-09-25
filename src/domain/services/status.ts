import {
  SERVICE_STATUSES,
  type AfterSalesType,
  type ServiceBucket,
  type ServiceKind,
  type ServiceStatus,
} from './types';

/** Mirrors app.service_status_terminal / app.service_customer_can_cancel / app.service_status_valid. */
export const TERMINAL_STATUSES = ['completed', 'cancelled', 'rejected', 'not_available'] as const;

export function isTerminal(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

const CUSTOMER_CANCEL: Record<ServiceKind, readonly string[]> = {
  repair: ['new', 'under_review', 'consultation_required', 'quote_sent'],
  trade_in: [
    'new',
    'under_review',
    'need_more_info',
    'inspection_required',
    'valuation_ready',
    'offer_sent',
    'customer_declined',
  ],
  used: ['new', 'searching', 'option_found', 'offer_sent'],
  after_sales: ['new', 'under_review'],
};

export function customerCanCancel(kind: ServiceKind, status: string): boolean {
  return CUSTOMER_CANCEL[kind].includes(status);
}

const HANDLING: Record<string, AfterSalesType> = {
  exchange_handling: 'exchange',
  refund_handling: 'return',
  warranty_handling: 'warranty',
};

export function statusValid(
  kind: ServiceKind,
  status: string,
  afterSalesType: AfterSalesType | null,
): status is ServiceStatus {
  if (!(SERVICE_STATUSES[kind] as readonly string[]).includes(status)) return false;
  const needed = HANDLING[status];
  return !(kind === 'after_sales' && needed && needed !== afterSalesType);
}

/** Offer states are reached by sending an offer, not by a bare status change. */
export function statusNeedsOffer(kind: ServiceKind, status: string): boolean {
  return (
    status === 'quote_sent' ||
    status === 'valuation_ready' ||
    status === 'option_found' ||
    (status === 'offer_sent' && kind === 'trade_in')
  );
}

/** Statuses staff may pick directly for a request (excludes offer states and the current one). */
export function staffStatusOptions(
  kind: ServiceKind,
  current: string,
  afterSalesType: AfterSalesType | null,
): ServiceStatus[] {
  if (isTerminal(current)) return [];
  return SERVICE_STATUSES[kind].filter(
    (s) =>
      s !== current &&
      s !== 'new' &&
      statusValid(kind, s, afterSalesType) &&
      !statusNeedsOffer(kind, s) &&
      !(kind === 'after_sales' && (s === 'approved' || s === 'rejected')),
  );
}

/** Only meaningful status changes notify (mirrors app.service_status_template). */
export function statusTemplate(kind: ServiceKind, status: string): string | null {
  if (status === 'cancelled') return 'service.cancelled';
  switch (kind) {
    case 'repair':
      if (status === 'ready') return 'service.repair.ready';
      return ['consultation_required', 'device_received', 'repairing', 'completed'].includes(status)
        ? 'service.updated'
        : null;
    case 'trade_in':
      if (status === 'need_more_info') return 'service.info_needed';
      if (status === 'inspection_required') return 'service.trade_in.inspection';
      if (status === 'rejected') return 'service.trade_in.rejected';
      return ['device_received', 'completed'].includes(status) ? 'service.updated' : null;
    case 'used':
      if (status === 'offer_sent') return 'service.used.offer_sent';
      if (status === 'not_available') return 'service.used.not_available';
      return ['reserved', 'completed'].includes(status) ? 'service.updated' : null;
    case 'after_sales':
      if (status === 'approved') return 'service.after_sales.approved';
      if (status === 'rejected') return 'service.after_sales.rejected';
      if (status === 'inspection') return 'service.after_sales.inspection';
      if (status === 'completed') return 'service.after_sales.completed';
      return [
        'item_received',
        'exchange_handling',
        'refund_handling',
        'warranty_handling',
      ].includes(status)
        ? 'service.updated'
        : null;
  }
}

export const NUMBER_PREFIX: Record<ServiceKind, string> = {
  repair: 'RP',
  trade_in: 'TI',
  used: 'UD',
  after_sales: 'AS',
};

export const SERVICE_BUCKET: Record<ServiceKind, ServiceBucket> = {
  repair: 'repairs',
  trade_in: 'trade-in',
  used: 'used-requests',
  after_sales: 'after-sales',
};

export function kindFromNumber(number: string): ServiceKind | null {
  const prefix = number.slice(0, 2).toUpperCase();
  const found = (Object.entries(NUMBER_PREFIX) as [ServiceKind, string][]).find(
    ([, p]) => p === prefix,
  );
  return found ? found[0] : null;
}

/**
 * The main path of each request type, used for the customer progress indicator. Side states
 * (cancelled, rejected, not available, declined, consultation) are shown on the timeline only.
 */
export const PROGRESS_PATH: Record<ServiceKind, readonly string[]> = {
  repair: ['new', 'under_review', 'diagnosing', 'quote_sent', 'repairing', 'ready', 'completed'],
  trade_in: [
    'new',
    'under_review',
    'offer_sent',
    'customer_accepted',
    'device_received',
    'completed',
  ],
  used: ['new', 'searching', 'option_found', 'customer_interested', 'reserved', 'completed'],
  after_sales: ['new', 'under_review', 'approved', 'inspection', 'completed'],
};

const PROGRESS_ALIASES: Record<string, string> = {
  consultation_required: 'under_review',
  device_received: 'diagnosing',
  customer_approved: 'repairing',
  quality_check: 'repairing',
  need_more_info: 'under_review',
  inspection_required: 'under_review',
  valuation_ready: 'offer_sent',
  customer_declined: 'offer_sent',
  offer_sent: 'offer_sent',
  item_received: 'inspection',
  exchange_handling: 'inspection',
  refund_handling: 'inspection',
  warranty_handling: 'inspection',
};

/** Index of the current step on PROGRESS_PATH (−1 for terminal side states). */
export function progressIndex(kind: ServiceKind, status: string): number {
  const path = PROGRESS_PATH[kind];
  if (kind === 'used' && status === 'offer_sent') return path.indexOf('option_found');
  const direct = path.indexOf(status);
  if (direct >= 0) return direct;
  const alias = PROGRESS_ALIASES[status];
  return alias ? path.indexOf(alias) : -1;
}
