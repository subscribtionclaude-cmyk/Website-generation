import { usePageMeta } from '@/features/seo/usePageMeta';
import { useAdminI18n } from './i18n/context';

/** Admin pages are never indexed; titles read "<page> · Admin | MALEK STORE". */
export function useAdminPageMeta(title: string) {
  const { at } = useAdminI18n();
  usePageMeta({ title: `${title} · ${at('shell.title')}`, noIndex: true });
}
