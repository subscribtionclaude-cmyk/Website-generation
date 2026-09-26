import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { readStored, removeStored, writeStored } from '@/lib/storage/localStore';

/**
 * Local draft recovery for long service forms. Autosaves the form (debounced) once the customer
 * has changed something; offers Restore / Discard on the next visit. Stores plain form data and
 * the paths of files that were already uploaded — never the media files themselves. Drafts older
 * than 14 days are ignored.
 */
const MAX_AGE_MS = 14 * 86_400_000;
const draftSchema = z.object({ savedAt: z.string(), data: z.unknown() });

export function useServiceDraft<T>(key: string, value: T, dirty: boolean) {
  const storageKey = `service-draft:${key}`;
  const [pending, setPending] = useState<{ savedAt: string; data: T } | null>(() => {
    const stored = readStored(storageKey, draftSchema);
    if (!stored || Date.now() - new Date(stored.savedAt).getTime() > MAX_AGE_MS) return null;
    return stored as { savedAt: string; data: T };
  });
  const suspended = useRef(false);

  useEffect(() => {
    // While a restore/discard choice is pending, never overwrite the saved draft.
    if (!dirty || pending || suspended.current) return;
    const timer = window.setTimeout(() => {
      writeStored(storageKey, { savedAt: new Date().toISOString(), data: value });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [storageKey, value, dirty, pending]);

  return {
    pending,
    restore(): T | null {
      const data = pending?.data ?? null;
      setPending(null);
      return data;
    },
    discard() {
      removeStored(storageKey);
      setPending(null);
    },
    /** Call after a successful submission. */
    clear() {
      suspended.current = true;
      removeStored(storageKey);
      setPending(null);
    },
  };
}
