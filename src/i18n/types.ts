/** Deeply widen literal string leaves to `string` so translations can mirror the source shape. */
export type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };

/** Union of dot-separated leaf paths, e.g. `"common.retry" | "auth.errors.invalidCode"`. */
export type MessagePath<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string
    ? `${Prefix}${K}`
    : MessagePath<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type MessageParams = Record<string, string | number>;
