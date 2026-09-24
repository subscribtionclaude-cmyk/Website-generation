import type { z } from 'zod';

/**
 * Namespaced, versioned, schema-validated browser storage.
 * Storage can be unavailable (private mode, blocked cookies) — every call degrades gracefully.
 * Never store secrets, tokens or authoritative commerce data here.
 */
const PREFIX = 'malek:v1:';

type StorageKind = 'local' | 'session';

function getStorage(kind: StorageKind): Storage | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readStored<T>(
  key: string,
  schema: z.ZodType<T>,
  kind: StorageKind = 'local',
): T | null {
  const storage = getStorage(kind);
  if (!storage) return null;
  try {
    const raw = storage.getItem(PREFIX + key);
    if (raw === null) return null;
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: unknown, kind: StorageKind = 'local'): boolean {
  const storage = getStorage(kind);
  if (!storage) return false;
  try {
    storage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeStored(key: string, kind: StorageKind = 'local'): void {
  try {
    getStorage(kind)?.removeItem(PREFIX + key);
  } catch {
    // ignore
  }
}
