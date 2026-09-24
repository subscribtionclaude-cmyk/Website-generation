import { normalizeEgyptianPhone } from './phone';

export type WhatsAppLinkResult =
  { status: 'ok'; url: string } | { status: 'not_configured' } | { status: 'invalid_number' };

const MAX_MESSAGE_LENGTH = 1500;

/**
 * Build a wa.me click-to-chat link. Never produces a broken link:
 * callers must handle `not_configured` / `invalid_number` (show guidance instead of a button).
 * Context-aware messages (product/variant, order number, trade-in/repair reference) are composed
 * by the calling feature and passed in as `message`.
 */
export function buildWhatsAppLink(
  configuredNumber: string | null | undefined,
  message?: string,
): WhatsAppLinkResult {
  if (!configuredNumber || configuredNumber.trim() === '') return { status: 'not_configured' };
  const e164 = normalizeEgyptianPhone(configuredNumber);
  if (!e164) return { status: 'invalid_number' };
  const base = `https://wa.me/${e164.slice(1)}`;
  const text = message?.trim().slice(0, MAX_MESSAGE_LENGTH);
  return { status: 'ok', url: text ? `${base}?text=${encodeURIComponent(text)}` : base };
}
