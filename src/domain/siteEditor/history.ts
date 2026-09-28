/**
 * Undo / redo for one editing session (in memory only; drafts are what persist). Consecutive
 * changes with the same `tag` inside `coalesceMs` (typing in one field) become one undo step.
 */
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  lastTag: string | null;
  lastAt: number;
}

export const HISTORY_LIMIT = 100;

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [], lastTag: null, lastAt: 0 };
}

export function commit<T>(
  history: History<T>,
  next: T,
  tag: string | null = null,
  now = Date.now(),
  coalesceMs = 1000,
): History<T> {
  if (Object.is(next, history.present)) return history;
  const coalesce = tag !== null && tag === history.lastTag && now - history.lastAt < coalesceMs;
  if (coalesce) return { ...history, present: next, future: [], lastAt: now };
  return {
    past: [...history.past, history.present].slice(-HISTORY_LIMIT),
    present: next,
    future: [],
    lastTag: tag,
    lastAt: now,
  };
}

export function undo<T>(history: History<T>): History<T> {
  const previous = history.past.at(-1);
  if (previous === undefined) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
    lastTag: null,
    lastAt: 0,
  };
}

export function redo<T>(history: History<T>): History<T> {
  const [next, ...rest] = history.future;
  if (next === undefined) return history;
  return {
    past: [...history.past, history.present].slice(-HISTORY_LIMIT),
    present: next,
    future: rest,
    lastTag: null,
    lastAt: 0,
  };
}

/** Replace the present without an undo step (e.g. after loading or saving a draft). */
export function reset<T>(present: T): History<T> {
  return createHistory(present);
}
