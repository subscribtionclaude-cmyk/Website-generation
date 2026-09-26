/**
 * Free, built-in analytics hooks. Events are dispatched in-page only (a `malek:analytics` DOM event
 * and an in-memory ring buffer); nothing is sent to any third party. Phase 06 analytics can
 * register a sink that stores them in the platform's own database.
 */
export type AnalyticsEvent =
  | 'repair_started'
  | 'repair_submitted'
  | 'diagnostic_part_selected'
  | 'trade_in_started'
  | 'trade_in_submitted'
  | 'used_request_submitted'
  | 'after_sales_submitted';

export interface TrackedEvent {
  name: AnalyticsEvent;
  props: Record<string, string | number | boolean | null>;
  at: string;
}

type Sink = (event: TrackedEvent) => void;

const buffer: TrackedEvent[] = [];
const sinks = new Set<Sink>();

export function track(name: AnalyticsEvent, props: TrackedEvent['props'] = {}): void {
  const event: TrackedEvent = { name, props, at: new Date().toISOString() };
  buffer.push(event);
  if (buffer.length > 100) buffer.shift();
  for (const sink of sinks) {
    try {
      sink(event);
    } catch {
      // A failing sink must never break the page.
    }
  }
  if (typeof window !== 'undefined')
    window.dispatchEvent(new CustomEvent('malek:analytics', { detail: event }));
}

export function addAnalyticsSink(sink: Sink): () => void {
  sinks.add(sink);
  return () => sinks.delete(sink);
}

export function recentEvents(): readonly TrackedEvent[] {
  return buffer;
}
