import type { SupabaseClient } from '@supabase/supabase-js';
import type { z } from 'zod';
import { RepositoryError } from './errors';

/** Call a Postgres RPC and validate its JSON with zod. Raw database errors never reach the UI. */
export async function rpc<T>(
  client: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
  schema: z.ZodType<T>,
): Promise<T> {
  const { data, error } = await client.rpc(fn, args);
  if (error) {
    const forbidden = error.code === '42501' || error.code === '28000' || error.code === 'PGRST301';
    throw new RepositoryError(
      `Supabase ${fn} failed`,
      error,
      forbidden ? 'forbidden' : 'unavailable',
    );
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success)
    throw new RepositoryError(
      `Unexpected ${fn} payload: ${parsed.error.issues[0]?.message}`,
      parsed.error,
      'invalid_response',
    );
  return parsed.data;
}
