import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { AuthError, type AuthService, type AuthSession, type RequestCodeOptions } from './types';

function toSession(session: Session | null): AuthSession | null {
  if (!session) return null;
  return { userId: session.user.id, email: session.user.email ?? null, isDemo: false };
}

function toAuthError(error: unknown): AuthError {
  if (error instanceof AuthError) return error;
  const candidate = error as { status?: number; code?: string; name?: string; message?: string };
  if (candidate.name === 'AuthRetryableFetchError' || candidate.status === 0) {
    return new AuthError('network', candidate.message);
  }
  if (candidate.status === 429 || candidate.code === 'over_email_send_rate_limit') {
    return new AuthError('rate_limited', candidate.message);
  }
  if (
    candidate.code === 'otp_expired' ||
    candidate.code === 'invalid_credentials' ||
    candidate.status === 403
  ) {
    return new AuthError('invalid_code', candidate.message);
  }
  if (candidate.code === 'email_address_invalid' || candidate.code === 'validation_failed') {
    return new AuthError('invalid_email', candidate.message);
  }
  return new AuthError('unknown', candidate.message);
}

/** Free-first auth: Supabase email OTP (6-digit code) + magic link — no paid SMS required. */
export class SupabaseAuthService implements AuthService {
  readonly kind = 'supabase' as const;
  private readonly client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.client = client;
  }

  async getSession(): Promise<AuthSession | null> {
    const { data, error } = await this.client.auth.getSession();
    if (error) throw toAuthError(error);
    return toSession(data.session);
  }

  subscribe(listener: (session: AuthSession | null) => void): () => void {
    const { data } = this.client.auth.onAuthStateChange((_event, session) => {
      // Defer: Supabase advises against running other client calls inside this callback.
      setTimeout(() => listener(toSession(session)), 0);
    });
    return () => data.subscription.unsubscribe();
  }

  async requestEmailCode(email: string, options: RequestCodeOptions): Promise<void> {
    const { error } = await this.client.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: options.redirectTo,
        data: { locale: options.locale },
      },
    });
    if (error) throw toAuthError(error);
  }

  async verifyEmailCode(email: string, code: string): Promise<AuthSession> {
    const { data, error } = await this.client.auth.verifyOtp({ email, token: code, type: 'email' });
    if (error) throw toAuthError(error);
    const session = toSession(data.session);
    if (!session) throw new AuthError('invalid_code');
    return session;
  }

  async signOut(): Promise<void> {
    const { error } = await this.client.auth.signOut();
    if (error) throw toAuthError(error);
  }
}
