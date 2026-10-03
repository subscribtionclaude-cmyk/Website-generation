/**
 * Netlify-style `_redirects` / `_headers` parsing (the subset this project uses), shared by the
 * local preview server (vite.config.ts — so every E2E run exercises the real host rules) and the
 * tests that keep the rules in sync with the route table. No DOM or Node APIs.
 */
export interface RedirectRule {
  from: string;
  to: string;
  status: number;
}

export interface HeaderRule {
  pattern: string;
  headers: [string, string][];
}

const lines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim() !== '' && !l.trim().startsWith('#'));

/** `/admin/*` matches below /admin; `/*` matches everything; other patterns match exactly. */
export function pathMatches(pattern: string, path: string): boolean {
  if (pattern === '/*') return true;
  if (pattern.endsWith('/*')) return path.startsWith(pattern.slice(0, -1));
  return path === pattern || path === `${pattern}/`;
}

export function parseRedirects(text: string): RedirectRule[] {
  return lines(text).map((line) => {
    const [from = '', to = '', status = '301'] = line.trim().split(/\s+/);
    return { from, to, status: Number(status) };
  });
}

export function matchRedirect(rules: RedirectRule[], path: string): RedirectRule | null {
  return rules.find((r) => pathMatches(r.from, path)) ?? null;
}

export function parseHeaders(text: string): HeaderRule[] {
  const rules: HeaderRule[] = [];
  for (const line of lines(text)) {
    if (!/^\s/.test(line)) {
      rules.push({ pattern: line.trim(), headers: [] });
      continue;
    }
    const current = rules.at(-1);
    const colon = line.indexOf(':');
    if (current && colon > 0)
      current.headers.push([line.slice(0, colon).trim(), line.slice(colon + 1).trim()]);
  }
  return rules;
}

/** Every matching rule applies, in file order (later values win), like Netlify. */
export function headersFor(rules: HeaderRule[], path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rule of rules)
    if (pathMatches(rule.pattern, path)) for (const [k, v] of rule.headers) out[k] = v;
  return out;
}
