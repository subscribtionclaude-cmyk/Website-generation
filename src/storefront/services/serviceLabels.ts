// Registers the service strings (kept out of the entry chunk) before any service UI renders.
import '@/i18n/messages/services';
import {
  CircleCheck,
  CircleDot,
  CircleX,
  Hourglass,
  MessageCircleQuestion,
  PackageCheck,
  RefreshCw,
  Smartphone,
  Undo2,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { isTerminal } from '@/domain/services/status';
import type { ServiceKind } from '@/domain/services/types';
import type { CoreMessageKey } from '@/i18n/context';

/** Labels and visual tone for service statuses (text + icon, never colour alone). */
export const KIND_LABEL: Record<ServiceKind, CoreMessageKey> = {
  repair: 'services.kindRepair',
  trade_in: 'services.kindTradeIn',
  used: 'services.kindUsed',
  after_sales: 'services.kindAfterSales',
};

export const KIND_ICON: Record<ServiceKind, LucideIcon> = {
  repair: Wrench,
  trade_in: RefreshCw,
  used: Smartphone,
  after_sales: Undo2,
};

export function statusLabelKey(status: string): CoreMessageKey {
  return `serviceStatus.${status}` as CoreMessageKey;
}

export type StatusTone = 'active' | 'action' | 'good' | 'closed';

const GOOD = [
  'completed',
  'ready',
  'approved',
  'customer_accepted',
  'customer_approved',
  'reserved',
];
const ACTION = ['quote_sent', 'offer_sent', 'option_found', 'need_more_info', 'valuation_ready'];

export function statusTone(status: string, awaitingCustomer = false): StatusTone {
  if (awaitingCustomer || ACTION.includes(status)) return 'action';
  if (GOOD.includes(status)) return 'good';
  if (isTerminal(status)) return 'closed';
  return 'active';
}

export function statusIcon(status: string, awaitingCustomer = false): LucideIcon {
  if (status === 'cancelled' || status === 'rejected' || status === 'not_available') return CircleX;
  if (status === 'completed') return PackageCheck;
  const tone = statusTone(status, awaitingCustomer);
  if (tone === 'action') return MessageCircleQuestion;
  if (tone === 'good') return CircleCheck;
  return status === 'new' ? CircleDot : Hourglass;
}

export const AFTER_SALES_TYPE_LABEL: Record<string, CoreMessageKey> = {
  exchange: 'afterSales.typeExchange',
  return: 'afterSales.typeReturn',
  warranty: 'afterSales.typeWarranty',
};

export const PROBLEM_MESSAGE: Record<string, CoreMessageKey> = {
  invalid_name: 'services.errorName',
  invalid_phone: 'services.errorPhone',
  invalid_device: 'services.errorDevice',
  invalid_diagnosis: 'services.errorDiagnosis',
  invalid_description: 'services.errorDescription',
  invalid_battery: 'services.errorBattery',
  invalid_condition: 'services.errorCondition',
  invalid_target: 'services.errorTarget',
  invalid_budget: 'services.errorBudget',
  invalid_reason: 'services.errorReason',
  not_eligible: 'services.errorNotEligible',
  not_delivered: 'services.errorNotDelivered',
  duplicate_open: 'services.errorDuplicate',
  policy_required: 'services.errorPolicy',
  policy_changed: 'services.errorPolicyChanged',
  too_many_open: 'services.errorTooManyOpen',
  service_disabled: 'services.errorDisabled',
  media_missing: 'services.errorMedia',
  media_in_use: 'services.errorMedia',
  invalid_media: 'services.errorMedia',
  invalid_media_type: 'media.errorType',
  media_too_large: 'media.errorSize',
  too_many_files: 'media.errorCount',
  too_many_videos: 'media.errorVideos',
  video_not_allowed: 'media.errorVideoNotAllowed',
  message_required: 'services.errorMessage',
  offer_expired: 'services.errorOfferExpired',
  offer_closed: 'services.errorOfferClosed',
  cannot_cancel: 'services.errorCannotCancel',
  closed: 'services.errorClosed',
  not_found: 'services.errorNotFound',
};
