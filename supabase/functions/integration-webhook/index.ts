// Supabase Edge Function (Deno): inbound provider webhooks (WhatsApp Cloud API delivery receipts).
// Deployed with JWT verification OFF (providers cannot send a Supabase JWT); every POST is instead
// verified with the provider's HMAC signature (WHATSAPP_WEBHOOK_SECRET) before anything is
// recorded, and provider event IDs are de-duplicated in the database.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleWhatsappWebhook } from '../../../src/domain/integrations/server/handler.ts';

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

Deno.serve(async (request) => {
  const service = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  try {
    const result = await handleWhatsappWebhook(
      {
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: await request.text(),
      },
      { service, env: (name) => Deno.env.get(name) },
    );
    const isText = typeof result.body === 'string';
    return new Response(isText ? (result.body as string) : JSON.stringify(result.body), {
      status: result.status,
      headers: {
        'Content-Type': isText ? 'text/plain' : 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return new Response('error', { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
});
