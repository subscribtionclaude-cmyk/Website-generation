import type { Locale } from '@/i18n/config';

export interface AuthSession {
  userId: string;
  email: string | null;
  /** True only for simulated sessions in demo mode. */
  isDemo: boolean;
}

export type AuthErrorCode =
  'invalid_email' | 'invalid_code' | 'rate_limited' | 'network' | 'unknown';

export class AuthError extends Error {
  readonly code: AuthErrorCode;

  constructor(code: AuthErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'AuthError';
    this.code = code;
  }
}

export interface RequestCodeOptions {
  /** Absolute URL the magic link in the email returns to. */
  redirectTo: string;
  locale: Locale;
}

/**
 * Authentication port. Free-first default: Supabase Auth email OTP / magic link.
 * Optional providers (SMS/WhatsApp OTP, Google, Apple) plug in later behind this interface
 * via the Integrations layer and are disabled by default.
 */
export interface AuthService {
  readonly kind: 'supabase' | 'demo';
  getSession(): Promise<AuthSession | null>;
  subscribe(listener: (session: AuthSession | null) => void): () => void;
  requestEmailCode(email: string, options: RequestCodeOptions): Promise<void>;
  verifyEmailCode(email: string, code: string): Promise<AuthSession>;
  signOut(): Promise<void>;
  /** Demo-only capability: preview the admin as a given system role. Absent in live mode. */
  readonly demo?: DemoAuthCapabilities;
}

export interface DemoAuthCapabilities {
  signInAsRole(roleKey: string): Promise<AuthSession>;
  getRoleKey(): string | null;
}

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const OTP_PATTERN = /^\d{6}$/;
