import type { Location } from 'react-router';
import { describe, expect, it } from 'vitest';
import { scrollKey } from './router';

const at = (pathname: string, key: string, search = ''): Location =>
  ({
    pathname,
    search,
    hash: '',
    state: null,
    key,
    unstable_mask: undefined,
  }) as unknown as Location;

describe('scroll restoration key', () => {
  it('a freshly loaded page never reuses another page’s saved position', () => {
    // Every document load starts on the "default" entry: key it by URL instead.
    expect(scrollKey(at('/en/category/audio', 'default'))).toBe('/en/category/audio');
    expect(scrollKey(at('/en/category/phones', 'default'))).not.toBe(
      scrollKey(at('/en/category/audio', 'default')),
    );
    expect(scrollKey(at('/search', 'default', '?q=ipad'))).toBe('/search?q=ipad');
  });

  it('in-app navigations keep their own history-entry key', () => {
    expect(scrollKey(at('/en/category/audio', 'k3j9x2'))).toBe('k3j9x2');
  });
});
