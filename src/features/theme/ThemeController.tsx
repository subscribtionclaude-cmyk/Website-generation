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

  // Structured scales (Site Editor): whitelisted enum values → data attributes (see tokens.css).
  const { typeScale, headingWeight, spacing, radius } = theme;
  useEffect(() => {
    const root = document.documentElement;
    const attrs = {
      'data-type-scale': typeScale,
      'data-heading-weight': headingWeight,
      'data-spacing': spacing,
      'data-radius': radius,
    };
    for (const [name, value] of Object.entries(attrs)) {
      if (value && value !== 'default') root.setAttribute(name, value);
      else root.removeAttribute(name);
    }
  }, [typeScale, headingWeight, spacing, radius]);

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
