import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { z } from 'zod';
import { useSession } from '@/features/auth/context';
import { DEFAULT_LOCALE, type Locale } from '@/i18n/config';
import { readStored, writeStored } from '@/lib/storage/localStore';
import type { Profile } from '@/repositories/types';
import { useRuntime } from '@/runtime/context';

const localeSchema = z.enum(['ar', 'en']);

export const profileQueryKey = (userId: string | null) => ['profile', userId] as const;

/**
 * Per-admin dashboard language, independent from the storefront language.
 * Stored on the user's profile (`profiles.admin_locale`) in live mode, with a local copy so the
 * dashboard renders in the right language immediately.
 */
export function useAdminLocale(): [Locale, (locale: Locale) => void] {
  const { repositories } = useRuntime();
  const queryClient = useQueryClient();
  const session = useSession();
  const userId = session?.userId ?? null;
  const storageKey = `admin-locale:${userId ?? 'anonymous'}`;
  const [override, setOverride] = useState<{ userId: string | null; locale: Locale } | null>(null);

  const profile = useQuery({
    queryKey: profileQueryKey(userId),
    queryFn: () => repositories.profiles.getMyProfile(),
    enabled: userId !== null,
    staleTime: 5 * 60_000,
  });

  const locale =
    (override?.userId === userId ? override.locale : undefined) ??
    profile.data?.adminLocale ??
    readStored(storageKey, localeSchema) ??
    DEFAULT_LOCALE;

  const setLocale = useCallback(
    (next: Locale) => {
      setOverride({ userId, locale: next });
      writeStored(storageKey, next);
      if (userId) {
        queryClient.setQueryData<Profile | null>(profileQueryKey(userId), (current) =>
          current ? { ...current, adminLocale: next } : current,
        );
        repositories.profiles.updateMyPreferences({ adminLocale: next }).catch(() => {
          // Non-critical: the local copy keeps the preference on this device.
        });
      }
    },
    [queryClient, repositories.profiles, storageKey, userId],
  );

  return [locale, setLocale];
}
