import { describe, expect, it } from 'vitest';
import {
  isDialablePhone,
  isEgyptianMobile,
  normalizeEgyptianPhone,
  toLatinDigits,
  toTelHref,
} from './phone';
import { buildWhatsAppLink } from './whatsapp';

describe('Egyptian phone numbers', () => {
  it('normalizes the store numbers to E.164', () => {
    expect(normalizeEgyptianPhone('01212004229')).toBe('+201212004229');
    expect(normalizeEgyptianPhone('0121 200 3775')).toBe('+201212003775');
    expect(normalizeEgyptianPhone('+20 121 200 4229')).toBe('+201212004229');
    expect(normalizeEgyptianPhone('00201212004229')).toBe('+201212004229');
    expect(normalizeEgyptianPhone('201212004229')).toBe('+201212004229');
  });

  it('accepts Arabic-Indic digits', () => {
    expect(toLatinDigits('٠١٢١٢٠٠٤٢٢٩')).toBe('01212004229');
    expect(normalizeEgyptianPhone('٠١٢١٢٠٠٤٢٢٩')).toBe('+201212004229');
  });

  it('handles landlines, hotlines and invalid input', () => {
    expect(normalizeEgyptianPhone('0224567890')).toBe('+20224567890');
    expect(isEgyptianMobile('0224567890')).toBe(false);
    expect(isDialablePhone('19999')).toBe(true);
    expect(toTelHref('19999')).toBe('tel:19999');
    expect(normalizeEgyptianPhone('12345')).toBeNull();
    expect(normalizeEgyptianPhone('01312004229')).toBeNull();
    expect(toTelHref('call me')).toBeNull();
    expect(toTelHref('01212004229')).toBe('tel:+201212004229');
  });
});

describe('buildWhatsAppLink', () => {
  it('never builds a link when no number is configured', () => {
    expect(buildWhatsAppLink(null)).toEqual({ status: 'not_configured' });
    expect(buildWhatsAppLink('  ')).toEqual({ status: 'not_configured' });
  });

  it('reports invalid numbers instead of generating broken links', () => {
    expect(buildWhatsAppLink('12')).toEqual({ status: 'invalid_number' });
  });

  it('builds wa.me links with an encoded context message', () => {
    expect(buildWhatsAppLink('01212004229', 'طلب رقم MS-1001 · iPhone 18 Pro 256GB')).toEqual({
      status: 'ok',
      url: `https://wa.me/201212004229?text=${encodeURIComponent('طلب رقم MS-1001 · iPhone 18 Pro 256GB')}`,
    });
    expect(buildWhatsAppLink('01212004229')).toEqual({
      status: 'ok',
      url: 'https://wa.me/201212004229',
    });
  });
});
