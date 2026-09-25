import type { AddressFields } from './types';

/**
 * One address rule set for checkout delivery and saved addresses (mirrors
 * app.delivery_address_problem and create_order). Returns the failing field, or null.
 */
export function addressProblem(fields: AddressFields): keyof AddressFields | null {
  if (!/^[a-z_]{2,40}$/.test(fields.governorate.trim().toLowerCase())) return 'governorate';
  const area = fields.area.trim().length;
  if (area < 2 || area > 120) return 'area';
  const address = fields.address.trim().length;
  if (address < 5 || address > 400) return 'address';
  if ((fields.notes ?? '').trim().length > 400) return 'notes';
  return null;
}
