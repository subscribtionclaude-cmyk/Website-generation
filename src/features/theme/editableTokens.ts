import { isHexColor } from '@/lib/color';

/**
 * Design tokens the Admin Design Studio may override at runtime.
 * Keys are stable identifiers stored in the `theme` setting; values map to CSS custom properties.
 * Only whitelisted tokens with validated values are ever written to the document (no CSS injection).
 */
export const EDITABLE_COLOR_TOKENS = {
  brandPrimary: '--color-brand-primary',
  brandPrimaryHover: '--color-brand-primary-hover',
  brandPrimarySubtle: '--color-brand-primary-subtle',
  onBrandPrimary: '--color-on-brand-primary',
  brandText: '--color-brand-text',
  brandInk: '--color-brand-ink',
  onBrandInk: '--color-on-brand-ink',
  background: '--color-background',
  surface: '--color-surface',
  surfaceElevated: '--color-surface-elevated',
  surfaceInverse: '--color-surface-inverse',
  textPrimary: '--color-text-primary',
  textSecondary: '--color-text-secondary',
  border: '--color-border',
  success: '--color-success',
  warning: '--color-warning',
  danger: '--color-danger',
  info: '--color-info',
} as const;

export type EditableColorToken = keyof typeof EDITABLE_COLOR_TOKENS;

export const EDITABLE_COLOR_TOKEN_KEYS = Object.keys(EDITABLE_COLOR_TOKENS) as EditableColorToken[];

/** Returns only valid overrides as [cssVariable, value] pairs. */
export function toCssVariableOverrides(
  tokens: Partial<Record<string, unknown>>,
): [string, string][] {
  const entries: [string, string][] = [];
  for (const key of EDITABLE_COLOR_TOKEN_KEYS) {
    const value = tokens[key];
    if (isHexColor(value)) entries.push([EDITABLE_COLOR_TOKENS[key], value]);
  }
  return entries;
}
