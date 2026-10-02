/**
 * Notification delivery router (mirrors app.notify + app.notification_channel_available +
 * app.integration_event_allowed):
 *
 *   domain event → notification template → in-app (always) → for each external channel:
 *   provider configured AND enabled, channel switched on, event mapped for the channel,
 *   customer opted in, not demo data → one queued delivery (idempotent per notification × channel).
 *
 * Otherwise the channel is skipped with a reason, and the manual / in-app path stays in charge.
 */
export type ExternalChannel = 'email' | 'whatsapp' | 'sms';

export interface ChannelContext {
  providerEnabled: boolean;
  providerConfigured: boolean;
  channelSwitchedOn: boolean;
  /** Event → provider template mapping for this channel. */
  templateMap: Record<string, string>;
}

export interface RouteInput {
  templateKey: string | null;
  isDemo: boolean;
  /** Customer's opt-in for this category × channel. */
  preferences: Partial<Record<ExternalChannel, boolean>>;
  channels: Record<ExternalChannel, ChannelContext>;
}

export type ChannelDecision =
  | { channel: ExternalChannel; action: 'queue'; providerTemplate: string }
  | {
      channel: ExternalChannel;
      action: 'skip';
      reason:
        'provider_disabled' | 'channel_off' | 'event_not_mapped' | 'preference_off' | 'demo_data';
    };

export const EXTERNAL_CHANNELS: ExternalChannel[] = ['email', 'whatsapp', 'sms'];

export function routeNotification(input: RouteInput): { inApp: true; channels: ChannelDecision[] } {
  const channels = EXTERNAL_CHANNELS.map((channel): ChannelDecision => {
    const ctx = input.channels[channel];
    if (input.isDemo) return { channel, action: 'skip', reason: 'demo_data' };
    if (!ctx.providerEnabled || !ctx.providerConfigured)
      return { channel, action: 'skip', reason: 'provider_disabled' };
    if (!ctx.channelSwitchedOn) return { channel, action: 'skip', reason: 'channel_off' };
    const template = input.templateKey ? ctx.templateMap[input.templateKey] : undefined;
    if (!template) return { channel, action: 'skip', reason: 'event_not_mapped' };
    if (!input.preferences[channel]) return { channel, action: 'skip', reason: 'preference_off' };
    return { channel, action: 'queue', providerTemplate: template };
  });
  return { inApp: true, channels };
}

/** Private fields that must never reach an external messaging provider. */
const PRIVATE_MESSAGE_KEYS =
  /(note|internal|audit|payment|proof|media|token|secret|staff|ip_?address)/i;

/** Customer-facing variables only (staff notes, payment details, private media URLs removed). */
export function customerFacingVariables(
  vars: Record<string, unknown>,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(vars)) {
    if (PRIVATE_MESSAGE_KEYS.test(key)) continue;
    if (typeof value === 'number') out[key] = value;
    else if (typeof value === 'string' && !/^https?:\/\//i.test(value))
      out[key] = value.slice(0, 200);
  }
  return out;
}
