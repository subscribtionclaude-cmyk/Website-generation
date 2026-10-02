// Supabase Edge Function (Deno): server runtime for integrations — Test connection, ERP/POS sync and
// notification dispatch. Secrets are read from the function's environment by NAME (set with
// `supabase secrets set …`); they never reach the browser, the database or the repository.
// All logic lives in the tested, dependency-injected core (src/domain/integrations/server).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleIntegrationAction } from '../../../src/domain/integrations/server/handler.ts';

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('INTEGRATIONS_ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST')
    return new Response('method_not_allowed', { status: 405, headers: corsHeaders });
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const authorization = request.headers.get('Authorization');
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const user = authorization
    ? createClient(url, anonKey, {
        ...options,
        global: { headers: { Authorization: authorization } },
      })
    : null;
  const service = createClient(url, serviceKey, options);
  const body: unknown = await request.json().catch(() => null);
  try {
    const result = await handleIntegrationAction(body, {
      user,
      service,
      env: (name) => Deno.env.get(name),
      fetch: (input, init) => fetch(input, init),
    });
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch {
    // Never echo internals: the admin sees a safe code, details stay in the platform logs.
    return new Response(JSON.stringify({ ok: false, code: 'runtime_error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
