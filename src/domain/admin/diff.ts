/** Readable before/after diff for the audit log viewer (paths like `value.payments.cod`). */
export interface DiffEntry {
  path: string;
  kind: 'added' | 'removed' | 'changed';
  before?: unknown;
  after?: unknown;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Noise columns that change on every write and say nothing to a reviewer. */
export const DIFF_IGNORED_KEYS = new Set(['updated_at', 'updatedAt', 'search_vector']);

export function jsonDiff(before: unknown, after: unknown, path = '', limit = 200): DiffEntry[] {
  const out: DiffEntry[] = [];
  const walk = (a: unknown, b: unknown, p: string) => {
    if (out.length >= limit || same(a, b)) return;
    if (isObject(a) && isObject(b)) {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (DIFF_IGNORED_KEYS.has(key)) continue;
        const next = p ? `${p}.${key}` : key;
        if (!(key in a)) out.push({ path: next, kind: 'added', after: b[key] });
        else if (!(key in b)) out.push({ path: next, kind: 'removed', before: a[key] });
        else walk(a[key], b[key], next);
      }
      return;
    }
    if (a === undefined || a === null) {
      if (b !== undefined && b !== null)
        out.push({ path: p || '(value)', kind: 'added', after: b });
      return;
    }
    if (b === undefined || b === null) {
      out.push({ path: p || '(value)', kind: 'removed', before: a });
      return;
    }
    out.push({ path: p || '(value)', kind: 'changed', before: a, after: b });
  };
  walk(before, after, path);
  return out;
}

/** Compact display of a diffed value. */
export function formatDiffValue(value: unknown): string {
  if (value === undefined) return '—';
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  const text = JSON.stringify(value);
  return text.length > 240 ? `${text.slice(0, 239)}…` : text;
}

const SECRET_KEY = /password|secret|token|api_?key|otp|hash|idempotency|signature|credential/i;

/** Mirror of app.redact_secrets: secret-looking keys are masked at any depth. */
export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (isObject(value))
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        SECRET_KEY.test(k) ? '[redacted]' : redactSecrets(v),
      ]),
    );
  return value;
}
