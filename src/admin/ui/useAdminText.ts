import { RepositoryError } from '@/repositories/supabase/errors';
import { useAdminI18n, type AdminMessageKey } from '../i18n/context';
import { uiAr } from '../i18n/p6/ui';

const PROBLEM_CODES = new Set(Object.keys(uiAr.problems));

/** Readable text for an RPC business refusal code (`{ ok: false, code }`). */
export function useProblemText() {
  const { at } = useAdminI18n();
  return (code: string | null | undefined) => {
    if (!code) return at('problems.generic');
    const base = code.split(':')[0]?.trim() ?? code;
    return PROBLEM_CODES.has(base)
      ? at(`problems.${base}` as AdminMessageKey)
      : at('problems.generic');
  };
}

/** Readable text for a thrown repository error (permission / backend / payload problems). */
export function useErrorText() {
  const { at } = useAdminI18n();
  return (error: unknown, action = false) => {
    if (error instanceof RepositoryError) {
      if (error.code === 'forbidden')
        return at(action ? 'loadErrors.actionForbidden' : 'loadErrors.forbidden');
      if (error.code === 'invalid_response') return at('loadErrors.invalid');
    }
    return at(action ? 'loadErrors.actionFailed' : 'loadErrors.unavailable');
  };
}
