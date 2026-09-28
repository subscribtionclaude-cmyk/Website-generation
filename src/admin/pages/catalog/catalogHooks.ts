import { useQuery } from '@tanstack/react-query';
import { resolveLocalized, type LocalizedText } from '@/domain/localized';
import { useI18n } from '@/i18n/context';
import { useAdminRepo } from '../../ui/useAdminAction';

export function useLookups() {
  const repo = useAdminRepo();
  return useQuery({
    queryKey: ['admin', 'catalog-lookups'],
    queryFn: () => repo.catalogLookups(),
    staleTime: 60_000,
  });
}

export function useLocalized() {
  const { locale } = useI18n();
  return (value: LocalizedText | null | undefined) => resolveLocalized(value, locale);
}
