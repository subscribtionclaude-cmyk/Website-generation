// Read-only Google Sheets access with a service account (RS256 JWT -> access token).
// Required secrets: GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY. The Sheet must be shared (Viewer) with that account.
export const DEFAULT_SPREADSHEET_ID = '127WeIut5Jjwbs6sS2w6fmqikrRlZbPZERElYh7eWclQ';

const enc = new TextEncoder();
// GOOGLE_SHEETS_BASE / GOOGLE_TOKEN_URL are test hooks only; production uses the defaults.
const SHEETS = () => Deno.env.get('GOOGLE_SHEETS_BASE') ?? 'https://sheets.googleapis.com/v4/spreadsheets';
const b64url = (buf: ArrayBuffer | Uint8Array | string): string => {
  const bytes = typeof buf === 'string' ? enc.encode(buf) : buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem.replace(/\\n/g, '\n').replace(/-----BEGIN [A-Z ]+-----|-----END [A-Z ]+-----|\s+/g, '');
  const raw = atob(body); const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export class GoogleConfigError extends Error {}

export async function getAccessToken(): Promise<string> {
  const email = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_EMAIL');
  const key = Deno.env.get('GOOGLE_PRIVATE_KEY');
  if (!email || !key) throw new GoogleConfigError('Google credentials are not configured (GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY).');
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: email, scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: Deno.env.get('GOOGLE_TOKEN_URL') ?? 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3300,
  }));
  const cryptoKey = await crypto.subtle.importKey('pkcs8', pemToDer(key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, enc.encode(`${head}.${claim}`));
  const res = await fetch(Deno.env.get('GOOGLE_TOKEN_URL') ?? 'https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${b64url(sig)}` }),
  });
  if (!res.ok) throw new GoogleConfigError(`Google token request failed (${res.status}). Check the service account credentials.`);
  return (await res.json()).access_token as string;
}

export interface SheetTab { title: string; rows: number; cols: number }

export async function listTabs(token: string, spreadsheetId: string): Promise<{ title: string; tabs: SheetTab[] }> {
  const res = await fetch(`${SHEETS()}/${spreadsheetId}?fields=properties.title,sheets.properties`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 403 || res.status === 404) throw new GoogleConfigError('The service account cannot open the spreadsheet. Share it (Viewer) with the service account email.');
  if (!res.ok) throw new Error(`Sheets API error ${res.status}`);
  const j = await res.json();
  return {
    title: j.properties?.title ?? '',
    tabs: (j.sheets ?? []).map((s: { properties: { title: string; gridProperties: { rowCount: number; columnCount: number } } }) => ({
      title: s.properties.title, rows: s.properties.gridProperties.rowCount, cols: s.properties.gridProperties.columnCount,
    })),
  };
}

export async function readTab(token: string, spreadsheetId: string, tab: string): Promise<(string | number | boolean | null)[][]> {
  const range = encodeURIComponent(`'${tab.replace(/'/g, "''")}'`);
  const res = await fetch(
    `${SHEETS()}/${spreadsheetId}/values/${range}?valueRenderOption=UNFORMATTED_VALUE&majorDimension=ROWS`,
    { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Sheets API error ${res.status} while reading "${tab}"`);
  return (await res.json()).values ?? [];
}
