/**
 * Inbound webhook verification for providers that sign requests with a shared secret
 * (HMAC-SHA256, hex or base64 digest), with a timestamp window against replays. Uses Web Crypto
 * only, so the same code runs in the Edge Function, the browser and tests. Provider event IDs are
 * then recorded once by integration_record_webhook (duplicates ignored).
 */
export interface WebhookVerification {
  ok: boolean;
  reason: 'valid' | 'missing_signature' | 'bad_signature' | 'stale_timestamp' | 'missing_secret';
}

const encoder = new TextEncoder();

async function hmac(secret: string, payload: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
}

const toHex = (bytes: Uint8Array) =>
  [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

/** Constant-time comparison (no early exit on the first differing character). */
export function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export async function signWebhook(
  secret: string,
  body: string,
  timestamp?: string,
): Promise<string> {
  return toHex(await hmac(secret, timestamp ? `${timestamp}.${body}` : body));
}

/**
 * `signature` may carry a scheme prefix ("sha256=…", as Meta sends in X-Hub-Signature-256).
 * When `timestamp` (seconds) is given, it is part of the signed payload and must be within
 * `toleranceSeconds` of now.
 */
export async function verifyWebhook(options: {
  secret: string | undefined;
  body: string;
  signature: string | null;
  timestamp?: string | null;
  toleranceSeconds?: number;
  now?: Date;
}): Promise<WebhookVerification> {
  const { secret, body, signature } = options;
  if (!secret) return { ok: false, reason: 'missing_secret' };
  if (!signature) return { ok: false, reason: 'missing_signature' };
  if (options.timestamp !== undefined && options.timestamp !== null) {
    const seconds = Number(options.timestamp);
    const now = (options.now ?? new Date()).getTime() / 1000;
    if (!Number.isFinite(seconds) || Math.abs(now - seconds) > (options.toleranceSeconds ?? 300))
      return { ok: false, reason: 'stale_timestamp' };
  }
  const payload = options.timestamp ? `${options.timestamp}.${body}` : body;
  const digest = await hmac(secret, payload);
  const given = signature.replace(/^sha256=/i, '').trim();
  const valid = safeEqual(given.toLowerCase(), toHex(digest)) || safeEqual(given, toBase64(digest));
  return valid ? { ok: true, reason: 'valid' } : { ok: false, reason: 'bad_signature' };
}
