import { useEffect } from 'react';
import { useSettings } from '@/features/settings/context';
import { shouldReduceMotion } from './adaptiveMotion';
import { toCssVariableOverrides } from './editableTokens';

/**
 * Applies published Design Studio token overrides as CSS custom properties on :root.
 * Only whitelisted tokens with validated #RRGGBB values are applied; removed overrides are cleaned up.
 * Also applies adaptive motion: constrained devices get data-motion="reduced" (see tokens.css).
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

  useEffect(() => {
    const root = document.documentElement;
    if (root.dataset.motion || !shouldReduceMotion(navigator as never)) return;
    root.dataset.motion = 'reduced';
    return () => {
      delete root.dataset.motion;
    };
  }, []);

  return null;
}
