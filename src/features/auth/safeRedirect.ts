/**
 * Only allow same-origin, absolute-path redirects after sign-in (prevents open redirects such as
 * `?next=//evil.example` or `?next=https://evil.example`).
 */
export function safeNextPath(next: string | null | undefined, fallback: string): string {
  if (!next) return fallback;
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return fallback;
  for (const char of next) {
    if (char.charCodeAt(0) < 0x20) return fallback; // control characters
  }
  return next;
}
