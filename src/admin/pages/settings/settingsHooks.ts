import { useAdminI18n, type AdminMessageKey } from '../../i18n/context';

/** Title for a setting key (falls back to the key). */
export function useSettingTitle() {
  const { at } = useAdminI18n();
  return (key: string) => {
    const k = `settingsAdmin.key.${key}`;
    const text = at(k as AdminMessageKey);
    return text === k ? key : text;
  };
}
