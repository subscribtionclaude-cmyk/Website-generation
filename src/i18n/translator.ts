import type { MessageParams } from './types';

interface Tree {
  readonly [key: string]: string | Tree;
}

/**
 * Resolve a dot path. Keys may themselves contain dots (e.g. permission keys like "orders.view"
 * under `permissions`), so every split point is tried, longest-remaining-key first.
 */
function lookup(tree: Tree, path: string): string | undefined {
  if (Object.prototype.hasOwnProperty.call(tree, path)) {
    const value = tree[path];
    return typeof value === 'string' ? value : undefined;
  }
  const segments = path.split('.');
  for (let index = 1; index < segments.length; index += 1) {
    const node = tree[segments.slice(0, index).join('.')];
    if (node !== undefined && typeof node !== 'string') {
      const found = lookup(node, segments.slice(index).join('.'));
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

/** Replace `{name}` placeholders. Unknown placeholders are left visible to make gaps obvious. */
export function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

type Dictionaries = object | readonly object[] | (() => readonly object[]);

/**
 * Build a `t()` function over a dictionary with a fallback dictionary (Arabic by default).
 * Each side may be a list of dictionaries, or a function returning one (core + lazily registered
 * feature dictionaries, read at call time). Missing keys fall back to the fallback dictionaries, then to the key itself
 * (never crash the UI).
 */
export function createTranslator<Path extends string>(
  messages: Dictionaries,
  fallback: Dictionaries,
): (path: Path, params?: MessageParams) => string {
  const find = (source: Dictionaries, path: string) => {
    const trees = typeof source === 'function' ? source() : source;
    for (const tree of Array.isArray(trees) ? trees : [trees]) {
      const value = lookup(tree as Tree, path);
      if (value !== undefined) return value;
    }
    return undefined;
  };
  return (path, params) => {
    const template = find(messages, path) ?? find(fallback, path) ?? (path as string);
    return interpolate(template, params);
  };
}

/**
 * Wrap a left-to-right value (email, phone, code, URL) in Unicode FIRST STRONG ISOLATE … POP
 * DIRECTIONAL ISOLATE marks so it renders correctly when interpolated into Arabic sentences.
 */
export function isolate(value: string | number): string {
  return `\u2068${value}\u2069`;
}
