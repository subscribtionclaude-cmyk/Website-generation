import { useEffect } from 'react';
import { useSettings } from '@/features/settings/context';
import { toCssVariableOverrides } from './editableTokens';

/**
 * Applies published Design Studio token overrides as CSS custom properties on :root.
 * Only whitelisted tokens with validated #RRGGBB values are applied; removed overrides are cleaned up.
 */
export function ThemeController() {
  const { theme } = useSettings();

  useEffect(() => {
    const root = document.documentElement;
    const overrides = toCssVariableOverrides(theme.tokens);
    for (const [name, value] of overrides) root.style.setProperty(name, value);
    return () => {
      for (const [name] of overrides) root.style.removeProperty(name);
    };
  }, [theme.tokens]);

  return null;
}
