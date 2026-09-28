import { useEffect, useRef, useState } from 'react';
import { useBlocker } from 'react-router';
import type { LocalizedText } from '@/domain/localized';
import type { ConfirmOptions } from './Dialog';

/** Small state helper: `ask(options)` opens the confirmation, `bind` wires it to <ConfirmDialog>. */
export function useConfirm<T = void>() {
  const [state, setState] = useState<{ options: ConfirmOptions; payload: T } | null>(null);
  return {
    ask: (options: ConfirmOptions, payload: T) => setState({ options, payload }),
    close: () => setState(null),
    payload: state?.payload,
    options: state?.options ?? null,
    open: state !== null,
  };
}

/**
 * Warn before losing unsaved edits: in-app navigation shows an accessible dialog
 * (keep editing / leave), and closing or reloading the tab triggers the browser prompt.
 */
export function useDirtyGuard(dirty: boolean) {
  /** Set right before a programmatic navigation that must not be blocked (e.g. after saving). */
  const bypass = useRef(false);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && !bypass.current && currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  return {
    blocker,
    allowNavigation: () => {
      bypass.current = true;
    },
  };
}

/** Parse a number input; empty → null. */
export function numberOrNull(value: string): number | null {
  if (value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export interface LocalizedDraft {
  ar: string;
  en: string;
}

export const toDraft = (v: LocalizedText | null | undefined): LocalizedDraft => ({
  ar: v?.ar ?? '',
  en: v?.en ?? '',
});
