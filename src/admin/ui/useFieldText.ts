import { useAdminI18n, type AdminMessageKey } from '../i18n/context';
import type { SchemaFormContext } from './SchemaForm';

/**
 * Labels, hints and option names for schema-driven editors, looked up in the admin dictionary
 * (`fieldLabels`, `fieldHints`, `fieldOptions`). Full paths win over generic last-segment labels.
 */
export function useFieldText(): Pick<SchemaFormContext, 'label' | 'hint' | 'option'> {
  const { at } = useAdminI18n();
  const find = (key: string) => {
    const text = at(key as AdminMessageKey);
    return text === key ? undefined : text;
  };
  const last = (key: string) => key.split('.').at(-1) ?? key;
  return {
    label: (key) => find(`fieldLabels.${key}`) ?? find(`fieldLabels.any.${last(key)}`),
    hint: (key) => find(`fieldHints.${key}`),
    option: (key, value) =>
      find(`fieldOptions.${last(key)}.${String(value)}`) ??
      find(`fieldOptions.any.${String(value)}`),
  };
}
