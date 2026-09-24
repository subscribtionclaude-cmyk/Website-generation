import { describe, expect, it } from 'vitest';
import { normalizeIntl as clean } from '@/test/intl';
import { formatMoney, formatNumber, roundMoney } from './money';

describe('formatMoney (EGP, final prices)', () => {
  it('formats Arabic with Latin digits by default', () => {
    expect(clean(formatMoney(25000, { locale: 'ar', numerals: 'latn' }))).toBe('25,000 ج.م.');
  });

  it('supports Arabic-Indic digits when configured', () => {
    expect(clean(formatMoney(25000, { locale: 'ar', numerals: 'arab' }))).toBe('٢٥٬٠٠٠ ج.م.');
  });

  it('formats English with the EGP code', () => {
    expect(clean(formatMoney(25000, { locale: 'en', numerals: 'latn' }))).toBe('EGP 25,000');
  });

  it('shows piasters only when needed (auto) or when forced', () => {
    expect(clean(formatMoney(1234.5, { locale: 'en', numerals: 'latn' }))).toBe('EGP 1,234.50');
    expect(clean(formatMoney(1234, { locale: 'en', numerals: 'latn', fractionDigits: 2 }))).toBe(
      'EGP 1,234.00',
    );
  });

  it('never renders NaN or Infinity', () => {
    expect(formatMoney(Number.NaN, { locale: 'ar', numerals: 'latn' })).toBe('—');
    expect(formatNumber(Number.POSITIVE_INFINITY, { locale: 'en', numerals: 'latn' })).toBe('—');
  });
});

describe('roundMoney', () => {
  it('rounds half away from zero at 2 decimals without float artefacts', () => {
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
    expect(roundMoney(-2.675)).toBe(-2.68);
    expect(roundMoney(19999)).toBe(19999);
  });
});
