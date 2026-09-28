import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useRuntime } from '@/runtime/context';
import { useErrorText, useProblemText } from './useAdminText';

interface Outcome {
  ok: boolean;
  code?: string;
}

/**
 * Admin write helper: runs a repository call, turns `{ ok: false, code }` refusals and thrown
 * errors into readable text, and refreshes every admin query (plus extra keys) after success.
 * The database stays authoritative — this only reports what it decided.
 */
export function useAdminAction<A extends unknown[], R extends Outcome>(
  fn: (...args: A) => Promise<R>,
  options: { invalidate?: string[]; onSuccess?: (result: R) => void } = {},
) {
  const queryClient = useQueryClient();
  const problemText = useProblemText();
  const errorText = useErrorText();
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (args: A) => fn(...args),
  });
  const run = async (...args: A): Promise<R | null> => {
    setError(null);
    setCode(null);
    try {
      const result = await mutation.mutateAsync(args);
      if (!result.ok) {
        setCode(result.code ?? null);
        setError(problemText(result.code));
        return result;
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin'] }),
        // Storefront data shown in the same tab (demo mode, previews) must reflect the change.
        queryClient.invalidateQueries({ queryKey: ['public'] }),
        ...(options.invalidate ?? []).map((k) => queryClient.invalidateQueries({ queryKey: [k] })),
      ]);
      options.onSuccess?.(result);
      return result;
    } catch (e) {
      setError(errorText(e, true));
      return null;
    }
  };
  return {
    run,
    pending: mutation.isPending,
    error,
    code,
    reset: () => {
      setError(null);
      setCode(null);
    },
  };
}

/** Shortcut to the admin repository port. */
export function useAdminRepo() {
  return useRuntime().repositories.admin;
}
