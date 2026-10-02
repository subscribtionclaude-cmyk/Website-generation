import {
  configComplete,
  integrationSpec,
  type IntegrationKey,
  type SettingsValue,
} from './catalog.ts';

/**
 * Connection status is derived, never assumed: "credentials saved" is not "connected".
 *   not_configured   → required public settings missing
 *   disabled         → configured but switched off (manual fallback active)
 *   untested         → enabled, never tested ("Configured — Not Tested")
 *   connected        → last health check succeeded
 *   error            → last health check failed, or the circuit breaker is open
 */
export type IntegrationState = 'not_configured' | 'disabled' | 'untested' | 'connected' | 'error';

export interface StatusInput {
  key: IntegrationKey;
  provider: string | null;
  enabled: boolean;
  settings: SettingsValue;
  lastCheckStatus: 'connected' | 'failed' | null;
  circuitOpenUntil: string | null;
}

export interface IntegrationStatus {
  state: IntegrationState;
  /** The free / manual path is what customers get right now. */
  fallbackActive: boolean;
  requiresSubscription: boolean;
  mayRequireSubscription: boolean;
  circuitOpen: boolean;
}

export function deriveStatus(input: StatusInput, now: Date = new Date()): IntegrationStatus {
  const spec = integrationSpec(input.key);
  const complete = configComplete(input.key, input.provider, input.settings);
  const circuitOpen = input.circuitOpenUntil !== null && new Date(input.circuitOpenUntil) > now;
  const state: IntegrationState = !complete
    ? 'not_configured'
    : !input.enabled
      ? 'disabled'
      : circuitOpen || input.lastCheckStatus === 'failed'
        ? 'error'
        : input.lastCheckStatus === 'connected'
          ? 'connected'
          : 'untested';
  return {
    state,
    // An enabled provider that is not yet confirmed working still leaves the fallback in charge.
    fallbackActive: state !== 'connected',
    requiresSubscription: spec.subscription === 'required',
    mayRequireSubscription: spec.subscription === 'may_require',
    circuitOpen,
  };
}

/** Compact health summary for the Integrations Center header. */
export function healthSummary(states: IntegrationState[]) {
  return {
    connected: states.filter((s) => s === 'connected').length,
    disabled: states.filter((s) => s === 'disabled').length,
    error: states.filter((s) => s === 'error').length,
    needsSetup: states.filter((s) => s === 'not_configured' || s === 'untested').length,
  };
}
