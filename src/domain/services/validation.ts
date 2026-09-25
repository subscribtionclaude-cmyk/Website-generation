import type { RepairCategory } from '@/domain/settings/schemas';
import { normalizeEgyptianPhone } from '@/lib/phone';
import {
  AFTER_SALES_REASONS,
  AFTER_SALES_TYPES,
  BATTERY_PREFERENCES,
  TAX_PREFERENCES,
  TRADE_IN_ACCESSORIES,
  TRADE_IN_CONDITIONS,
  TRI_STATE,
  type AfterSalesInput,
  type RepairInput,
  type ServiceProblem,
  type TradeInInput,
  type UsedInput,
} from './types';

/**
 * Client-side mirror of public.create_service_request's validation — used by the forms (early,
 * field-level errors) and by the demo engine. The database remains the authority in live mode.
 */
export function cleanText(value: string | null | undefined, max: number): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0001-\u0009\u000b-\u001f\u007f]/g, '')
    .trim();
  if (trimmed === '' || value.trim().length > max) return null;
  return trimmed;
}

const KEY = /^[a-z][a-z0-9_]{1,39}$/;
const problem = (code: string, field?: string): ServiceProblem =>
  field ? { ok: false, code, field } : { ok: false, code };

export function normalizeMobile(phone: string): string | null {
  const e164 = normalizeEgyptianPhone(phone);
  return e164 && /^\+201[0125]\d{8}$/.test(e164) ? e164 : null;
}

export function contactProblem(contact: { name: string; phone: string }): ServiceProblem | null {
  const name = cleanText(contact.name, 120);
  if (!name || name.length < 2) return problem('invalid_name', 'name');
  if (!normalizeMobile(contact.phone)) return problem('invalid_phone', 'phone');
  return null;
}

export function repairProblem(
  input: RepairInput,
  catalog: RepairCategory[],
): ServiceProblem | null {
  const contact = contactProblem(input.contact);
  if (contact) return contact;
  const category = catalog.find((c) => c.key === input.device.category);
  if (!KEY.test(input.device.category) || (catalog.length > 0 && !category))
    return problem('invalid_device', 'category');
  if (!cleanText(input.device.brand, 60)) return problem('invalid_device', 'brand');
  if (!cleanText(input.device.model, 80)) return problem('invalid_device', 'model');
  const { component, symptom } = input.diagnosis;
  if (component) {
    const found = category?.components.find((c) => c.key === component);
    if (!found) return problem('invalid_diagnosis', 'component');
    if (symptom && !found.symptoms.some((s) => s.key === symptom))
      return problem('invalid_diagnosis', 'symptom');
  } else if (symptom) {
    return problem('invalid_diagnosis', 'symptom');
  }
  const description = cleanText(input.description, 2000);
  if (!description || description.length < 10) return problem('invalid_description', 'description');
  return null;
}

export function tradeInProblem(input: TradeInInput): ServiceProblem | null {
  const contact = contactProblem(input.contact);
  if (contact) return contact;
  const c = input.current;
  if (c.category !== null && !KEY.test(c.category)) return problem('invalid_device', 'category');
  if (!cleanText(c.brand, 60)) return problem('invalid_device', 'brand');
  if (!cleanText(c.model, 80)) return problem('invalid_device', 'model');
  if (
    c.batteryHealth !== null &&
    (!Number.isInteger(c.batteryHealth) || c.batteryHealth < 1 || c.batteryHealth > 100)
  )
    return problem('invalid_battery', 'batteryHealth');
  if (![c.taxPaid, c.openedBefore, c.repairedBefore].every((v) => TRI_STATE.includes(v)))
    return problem('invalid_request', 'current');
  if (!c.accessories.every((a) => (TRADE_IN_ACCESSORIES as readonly string[]).includes(a)))
    return problem('invalid_request', 'accessories');
  const conditions = [...new Set(c.conditions)];
  if (
    conditions.length === 0 ||
    !conditions.every((x) => (TRADE_IN_CONDITIONS as readonly string[]).includes(x)) ||
    (conditions.includes('none') && conditions.length > 1)
  )
    return problem('invalid_condition', 'conditions');
  if ('variantId' in input.target) {
    if (!input.target.variantId) return problem('invalid_target', 'target');
  } else if (
    !cleanText(input.target.manual.brand, 60) ||
    !cleanText(input.target.manual.model, 80)
  ) {
    return problem('invalid_target', 'target');
  }
  return null;
}

export function usedProblem(input: UsedInput): ServiceProblem | null {
  const contact = contactProblem(input.contact);
  if (contact) return contact;
  const d = input.device;
  if (d.category !== null && !KEY.test(d.category)) return problem('invalid_device', 'category');
  if (!cleanText(d.brand, 60)) return problem('invalid_device', 'brand');
  if (!cleanText(d.model, 80)) return problem('invalid_device', 'model');
  if (!BATTERY_PREFERENCES.includes(d.batteryPreference))
    return problem('invalid_request', 'batteryPreference');
  if (!TAX_PREFERENCES.includes(d.taxPreference))
    return problem('invalid_request', 'taxPreference');
  if (d.budget !== null && (!Number.isFinite(d.budget) || d.budget <= 0 || d.budget > 10_000_000))
    return problem('invalid_budget', 'budget');
  return null;
}

export function afterSalesProblem(
  input: AfterSalesInput,
  policyVersion: string,
): ServiceProblem | null {
  const contact = contactProblem(input.contact);
  if (contact) return contact;
  if (!AFTER_SALES_TYPES.includes(input.type)) return problem('invalid_request', 'type');
  if (!input.orderItemId) return problem('not_eligible', 'orderItemId');
  if (!AFTER_SALES_REASONS.includes(input.reason)) return problem('invalid_reason', 'reason');
  const description = cleanText(input.description, 2000);
  if (!description || description.length < 10) return problem('invalid_description', 'description');
  if (!input.policyAccepted) return problem('policy_required', 'policy');
  if (input.policyVersion !== policyVersion) return problem('policy_changed', 'policy');
  return null;
}
