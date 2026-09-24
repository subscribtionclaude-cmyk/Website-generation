import { z } from 'zod';
import { readStored, removeStored, writeStored } from '@/lib/storage/localStore';
import {
  AuthError,
  EMAIL_PATTERN,
  OTP_PATTERN,
  type AuthService,
  type AuthSession,
  type DemoAuthCapabilities,
} from './types';

const STORAGE_KEY = 'demo-session';

const storedSessionSchema = z.object({
  userId: z.string(),
  email: z.string().nullable(),
  roleKey: z.string().nullable(),
});

type StoredSession = z.infer<typeof storedSessionSchema>;

/**
 * DEMO MODE ONLY. Simulated sign-in so the storefront and the admin shell can be previewed without
 * a backend. No email is sent, nothing is persisted beyond this browser tab (sessionStorage), and it
 * protects nothing — there is no data behind it. Live mode never instantiates this class.
 */
export class DemoAuthService implements AuthService {
  readonly kind = 'demo' as const;
  private listeners = new Set<(session: AuthSession | null) => void>();

  readonly demo: DemoAuthCapabilities = {
    signInAsRole: async (roleKey: string) => {
      const session = this.store({
        userId: `demo-${roleKey}`,
        email: `${roleKey}@demo.invalid`,
        roleKey,
      });
      return session;
    },
    getRoleKey: () => this.read()?.roleKey ?? null,
  };

  private read(): StoredSession | null {
    return readStored(STORAGE_KEY, storedSessionSchema, 'session');
  }

  private store(value: StoredSession): AuthSession {
    writeStored(STORAGE_KEY, value, 'session');
    const session = { userId: value.userId, email: value.email, isDemo: true };
    this.emit(session);
    return session;
  }

  private emit(session: AuthSession | null) {
    for (const listener of this.listeners) listener(session);
  }

  async getSession(): Promise<AuthSession | null> {
    const stored = this.read();
    return stored ? { userId: stored.userId, email: stored.email, isDemo: true } : null;
  }

  subscribe(listener: (session: AuthSession | null) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async requestEmailCode(email: string): Promise<void> {
    if (!EMAIL_PATTERN.test(email)) throw new AuthError('invalid_email');
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  async verifyEmailCode(email: string, code: string): Promise<AuthSession> {
    if (!EMAIL_PATTERN.test(email)) throw new AuthError('invalid_email');
    if (!OTP_PATTERN.test(code)) throw new AuthError('invalid_code');
    return this.store({ userId: `demo-customer-${email.toLowerCase()}`, email, roleKey: null });
  }

  async signOut(): Promise<void> {
    removeStored(STORAGE_KEY, 'session');
    this.emit(null);
  }
}
