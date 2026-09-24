/** Offer/content time helpers. Countdowns are always derived from stored timestamps. */

export type OfferPhase = 'upcoming' | 'active' | 'expired';

export function offerPhase(startsAt: string | null, endsAt: string | null, now: Date): OfferPhase {
  const t = now.getTime();
  if (startsAt && new Date(startsAt).getTime() > t) return 'upcoming';
  if (endsAt && new Date(endsAt).getTime() <= t) return 'expired';
  return 'active';
}

export interface CountdownParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  totalMs: number;
}

export function countdownParts(endsAt: string, now: Date): CountdownParts | null {
  const totalMs = new Date(endsAt).getTime() - now.getTime();
  if (!Number.isFinite(totalMs) || totalMs <= 0) return null;
  const totalSeconds = Math.floor(totalMs / 1000);
  return {
    days: Math.floor(totalSeconds / 86_400),
    hours: Math.floor((totalSeconds % 86_400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
    totalMs,
  };
}
