import type { THEME_PRESETS } from '@/domain/settings/schemas';
import type { EditableColorToken } from '@/features/theme/editableTokens';

export type ThemePreset = (typeof THEME_PRESETS)[number];

/**
 * Starting palettes for the Site Editor. Choosing one fills the theme's colour tokens (which staff
 * can then adjust); "malek" is the brand default in tokens.css (no overrides). Every pairing keeps
 * WCAG AA contrast for body text (checked in siteEditor.test.ts).
 */
export const THEME_PRESET_TOKENS: Record<
  ThemePreset,
  Partial<Record<EditableColorToken, string>>
> = {
  malek: {},
  midnight: {
    brandPrimary: '#f65311',
    brandPrimaryHover: '#d9460b',
    brandPrimarySubtle: '#ffe4d4',
    onBrandPrimary: '#0b0b0c',
    brandText: '#b0390c',
    brandInk: '#17171a',
    onBrandInk: '#ffffff',
    surfaceInverse: '#17171a',
    surface: '#eeeef0',
    border: '#c9c9cf',
  },
  minimal: {
    brandPrimary: '#26262b',
    brandPrimaryHover: '#0b0b0c',
    brandPrimarySubtle: '#f6f6f7',
    onBrandPrimary: '#ffffff',
    brandText: '#26262b',
    brandInk: '#0b0b0c',
    onBrandInk: '#ffffff',
    surface: '#fcfcfd',
    border: '#e1e1e5',
  },
};

/** Token pairs checked for contrast when colours change (text on background). */
export const CONTRAST_PAIRS: [EditableColorToken, EditableColorToken, number][] = [
  ['textPrimary', 'background', 4.5],
  ['textSecondary', 'background', 4.5],
  ['brandText', 'background', 4.5],
  ['onBrandPrimary', 'brandPrimary', 4.5],
  ['onBrandInk', 'brandInk', 4.5],
  ['textPrimary', 'surface', 4.5],
];

/** Defaults from tokens.css (what an absent override means). */
export const TOKEN_DEFAULTS: Record<EditableColorToken, string> = {
  brandPrimary: '#f65311',
  brandPrimaryHover: '#d9460b',
  brandPrimarySubtle: '#fff4ed',
  onBrandPrimary: '#0b0b0c',
  brandText: '#b0390c',
  brandInk: '#0b0b0c',
  onBrandInk: '#ffffff',
  background: '#ffffff',
  surface: '#f6f6f7',
  surfaceElevated: '#ffffff',
  surfaceInverse: '#0b0b0c',
  textPrimary: '#0b0b0c',
  textSecondary: '#55555d',
  border: '#e1e1e5',
  success: '#0f6a34',
  warning: '#8a5000',
  danger: '#a51d1d',
  info: '#1a4fb2',
};
