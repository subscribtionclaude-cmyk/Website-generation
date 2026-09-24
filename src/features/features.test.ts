import { describe, expect, it } from 'vitest';
import css from '@/styles/tokens.css?raw';
import { contrastRatio } from '@/lib/color';
import { safeNextPath } from './auth/safeRedirect';
import { EDITABLE_COLOR_TOKENS, toCssVariableOverrides } from './theme/editableTokens';

const rootBlock = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
const vars = new Map(
  [...rootBlock.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [
    m[1] as string,
    (m[2] as string).trim(),
  ]),
);

function resolveColor(name: string): string {
  let value = vars.get(name);
  for (let depth = 0; value?.startsWith('var(') && depth < 5; depth += 1) {
    value = vars.get(value.slice(4, -1));
  }
  if (!value?.startsWith('#')) throw new Error(`Cannot resolve ${name} → ${value}`);
  return value;
}

describe('design tokens', () => {
  it('declares every editable semantic token in tokens.css', () => {
    for (const variable of Object.values(EDITABLE_COLOR_TOKENS))
      expect(vars.has(variable), variable).toBe(true);
  });

  it.each([
    ['--color-text-primary', '--color-background', 4.5],
    ['--color-text-secondary', '--color-background', 4.5],
    ['--color-text-muted', '--color-background', 4.5],
    ['--color-text-secondary', '--color-surface', 4.5],
    ['--color-on-brand-primary', '--color-brand-primary', 4.5],
    ['--color-on-brand-ink', '--color-brand-ink', 4.5],
    ['--color-brand-text', '--color-background', 4.5],
    ['--color-brand-text', '--color-brand-primary-subtle', 4.5],
    ['--color-text-inverse', '--color-surface-inverse', 4.5],
    ['--color-text-inverse-secondary', '--color-surface-inverse', 4.5],
    ['--color-success', '--color-success-subtle', 4.5],
    ['--color-warning', '--color-warning-subtle', 4.5],
    ['--color-danger', '--color-danger-subtle', 4.5],
    ['--color-info', '--color-info-subtle', 4.5],
    ['--color-focus-ring', '--color-background', 3],
  ])('%s on %s meets WCAG contrast', (fg, bg, minimum) => {
    expect(contrastRatio(resolveColor(fg), resolveColor(bg))).toBeGreaterThanOrEqual(minimum);
  });

  it('white text on the brand orange is not used for body text (fails AA) — documented in tokens.css', () => {
    expect(contrastRatio('#ffffff', resolveColor('--color-brand-primary'))).toBeLessThan(4.5);
  });

  it('only whitelisted, valid overrides reach the document', () => {
    expect(
      toCssVariableOverrides({ brandPrimary: '#FD4E00', textPrimary: 'red', evil: '#000000' }),
    ).toEqual([['--color-brand-primary', '#FD4E00']]);
  });
});

describe('safeNextPath', () => {
  it('allows same-origin paths and blocks open redirects', () => {
    expect(safeNextPath('/admin/orders?x=1', '/')).toBe('/admin/orders?x=1');
    expect(safeNextPath('//evil.example', '/')).toBe('/');
    expect(safeNextPath('https://evil.example', '/')).toBe('/');
    expect(safeNextPath('/\\evil.example', '/')).toBe('/');
    expect(safeNextPath('/a\nb', '/')).toBe('/');
    expect(safeNextPath(null, '/account')).toBe('/account');
  });
});
