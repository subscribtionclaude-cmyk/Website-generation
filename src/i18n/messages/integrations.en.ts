import type { Widen } from '../types';
import type { integrationsAr } from './integrations.ar';

/** English strings for the Phase 09 storefront integrations (see integrations.ar.ts). */
export const integrationsEn: Widen<typeof integrationsAr> = {
  integrations: {
    consent: {
      title: 'Analytics cookies',
      body: 'We use Google Analytics to measure visits to the public store pages only after you agree, with no personal data (no name, phone, email or address). It never loads in your account, checkout or order pages.',
      accept: 'Allow analytics',
      reject: 'Reject',
      manage: 'Cookie settings',
      current: 'Your current choice: {choice}',
      granted: 'Allowed',
      denied: 'Rejected',
      demo: 'Demo mode: no analytics data is sent.',
    },
    socialAuth: {
      divider: 'or',
      google: 'Continue with Google',
      apple: 'Continue with Apple',
      demo: 'Demo mode: Google and Apple sign-in are not available in the demo. Use the email code.',
      error: 'Could not start sign-in. Try again or use the email code.',
      privacy: 'With your consent we only receive your name and email from the account.',
    },
  },
};
