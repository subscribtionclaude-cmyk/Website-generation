import { describe, expect, it } from 'vitest';
import {
  catalogImageSources,
  catalogSrcSet,
  catalogThumbUrl,
  derivativePath,
  fitInSquare,
  isOfficialImageUrl,
  sourceProblem,
} from './media';

const SHA = 'a'.repeat(64);

describe('catalog media rules', () => {
  it('accepts only https URLs on official manufacturer domains', () => {
    expect(
      isOfficialImageUrl(
        'https://store.storeimages.cdn-apple.com/1/as-images.apple.com/is/iphone-17?wid=1200',
      ),
    ).toBe(true);
    expect(isOfficialImageUrl('https://images.samsung.com/is/image/samsung/p6pim/eg/x.png')).toBe(
      true,
    );
    expect(isOfficialImageUrl('https://i02.appmifile.com/mi-com-product/x.png')).toBe(true);
    expect(isOfficialImageUrl('http://www.apple.com/x.png')).toBe(false); // not https
    expect(isOfficialImageUrl('https://apple.com.evil.example/x.png')).toBe(false); // suffix trick
    expect(isOfficialImageUrl('https://notapple.com/x.png')).toBe(false);
    expect(isOfficialImageUrl('https://user:pw@www.apple.com/x.png')).toBe(false);
    expect(isOfficialImageUrl('https://www.apple.com:8443/x.png')).toBe(false);
    expect(isOfficialImageUrl('https://127.0.0.1/x.png')).toBe(false);
    expect(isOfficialImageUrl('https://shop.example.eg/iphone.jpg')).toBe(false); // random shop
    expect(isOfficialImageUrl('not a url')).toBe(false);
  });

  it('rejects unusable sources (type, size, swatches, banners)', () => {
    const ok = { contentType: 'image/png', bytes: 800_000, width: 1200, height: 1200 };
    expect(sourceProblem(ok)).toBeNull();
    expect(sourceProblem({ ...ok, contentType: 'image/jpeg; charset=binary' })).toBeNull();
    expect(sourceProblem({ ...ok, contentType: 'text/html' })).toBe('type');
    expect(sourceProblem({ ...ok, contentType: 'image/svg+xml' })).toBe('type');
    expect(sourceProblem({ ...ok, bytes: 0 })).toBe('empty');
    expect(sourceProblem({ ...ok, bytes: 25 * 1024 * 1024 })).toBe('too_large');
    expect(sourceProblem({ ...ok, width: 32, height: 32 })).toBe('too_small');
    expect(sourceProblem({ ...ok, width: 4000, height: 600 })).toBe('aspect');
  });

  it('fits images into a centred square without stretching', () => {
    expect(fitInSquare(1200, 2400, 480)).toEqual({ width: 240, height: 480, x: 120, y: 0 });
    expect(fitInSquare(2000, 1000, 1200)).toEqual({ width: 1200, height: 600, x: 0, y: 300 });
    expect(fitInSquare(1200, 1200, 480)).toEqual({ width: 480, height: 480, x: 0, y: 0 });
  });

  it('addresses derivatives by content hash (same file stored once)', () => {
    expect(derivativePath('apple', SHA, 480)).toBe('catalog/apple/aaaaaaaaaaaaaaaa-480.webp');
    expect(derivativePath('apple', SHA, 1200)).toBe('catalog/apple/aaaaaaaaaaaaaaaa-1200.webp');
    expect(() => derivativePath('../x', SHA, 480)).toThrow();
    expect(() => derivativePath('apple', 'zz', 480)).toThrow();
  });

  it('builds responsive sources only for ingested catalog images', () => {
    const base =
      'https://x.supabase.co/storage/v1/object/public/products/catalog/apple/0123456789abcdef';
    expect(catalogSrcSet(`${base}-1200.webp`)).toBe(
      `${base}-480.webp 480w, ${base}-1200.webp 1200w`,
    );
    expect(catalogSrcSet('/demo/media/iphone.webp')).toBeUndefined();
    expect(catalogSrcSet(`${base}-999.webp`)).toBeUndefined();
    expect(catalogThumbUrl(`${base}-1200.webp`)).toBe(`${base}-480.webp`);
    expect(catalogThumbUrl('/demo/media/iphone.webp')).toBe('/demo/media/iphone.webp');
    expect(catalogImageSources(`${base}-1200.webp`, '50vw')).toEqual({
      src: `${base}-480.webp`,
      srcSet: `${base}-480.webp 480w, ${base}-1200.webp 1200w`,
      sizes: '50vw',
    });
    expect(catalogImageSources('/demo/media/iphone.webp', '50vw')).toEqual({
      src: '/demo/media/iphone.webp',
    });
  });
});
