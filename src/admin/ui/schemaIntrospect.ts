import type { z } from 'zod';

/**
 * Minimal, read-only view of Zod 4 schema definitions used to render structured editors
 * (settings, page-section props) straight from the same schemas that validate them.
 */
interface LooseCheck {
  _zod: { def: { check: string; maximum?: number; minimum?: number } };
}
interface LooseDef {
  type: string;
  innerType?: z.ZodType;
  shape?: Record<string, z.ZodType>;
  element?: z.ZodType;
  entries?: Record<string, string | number>;
  values?: unknown[];
  options?: z.ZodType[];
  defaultValue?: unknown;
  checks?: LooseCheck[];
  in?: z.ZodType;
}

export const defOf = (schema: z.ZodType): LooseDef =>
  (schema as unknown as { _zod: { def: LooseDef } })._zod.def;

export interface Unwrapped {
  schema: z.ZodType;
  nullable: boolean;
  optional: boolean;
  defaultValue?: unknown;
}

/** Strip nullable / optional / default / pipe wrappers, remembering which ones were present. */
export function unwrap(schema: z.ZodType): Unwrapped {
  let current = schema;
  let nullable = false;
  let optional = false;
  let defaultValue: unknown;
  for (let i = 0; i < 10; i += 1) {
    const def = defOf(current);
    if (def.type === 'nullable' && def.innerType) {
      nullable = true;
      current = def.innerType;
    } else if (def.type === 'optional' && def.innerType) {
      optional = true;
      current = def.innerType;
    } else if ((def.type === 'default' || def.type === 'prefault') && def.innerType) {
      defaultValue = def.defaultValue;
      current = def.innerType;
    } else if (def.type === 'pipe' && def.in) {
      current = def.in;
    } else break;
  }
  return { schema: current, nullable, optional, defaultValue };
}

export type FieldKind =
  | 'localized'
  | 'object'
  | 'array'
  | 'enum'
  | 'literal'
  | 'string'
  | 'number'
  | 'boolean'
  | 'unsupported';

/** `{ ar, en? }` bilingual text objects render as one bilingual field. */
export function isLocalizedSchema(schema: z.ZodType): boolean {
  const def = defOf(schema);
  if (def.type !== 'object' || !def.shape) return false;
  const keys = Object.keys(def.shape).sort();
  return keys.length === 2 && keys[0] === 'ar' && keys[1] === 'en';
}

export function kindOf(schema: z.ZodType): FieldKind {
  const def = defOf(schema);
  if (isLocalizedSchema(schema)) return 'localized';
  switch (def.type) {
    case 'object':
      return 'object';
    case 'array':
      return 'array';
    case 'enum':
      return 'enum';
    case 'literal':
      return 'literal';
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'union':
      return (def.options ?? []).every((o) => defOf(o).type === 'literal') ? 'enum' : 'unsupported';
    default:
      return 'unsupported';
  }
}

/** Allowed values of an enum or a union of literals. */
export function enumValues(schema: z.ZodType): (string | number)[] {
  const def = defOf(schema);
  if (def.type === 'enum' && def.entries) return Object.values(def.entries);
  if (def.type === 'union')
    return (def.options ?? []).flatMap((o) => (defOf(o).values ?? []) as (string | number)[]);
  return [];
}

export function objectShape(schema: z.ZodType): Record<string, z.ZodType> {
  return defOf(schema).shape ?? {};
}

export function arrayElement(schema: z.ZodType): z.ZodType | null {
  return defOf(schema).element ?? null;
}

export function arrayMax(schema: z.ZodType): number | null {
  const check = defOf(schema).checks?.find((c) => c._zod.def.check === 'max_length');
  return check?._zod.def.maximum ?? null;
}

export function numberBounds(schema: z.ZodType): {
  min: number | null;
  max: number | null;
  int: boolean;
} {
  const n = schema as unknown as {
    minValue?: number | null;
    maxValue?: number | null;
    isInt?: boolean;
  };
  const finite = (v: number | null | undefined) =>
    typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < Number.MAX_SAFE_INTEGER ? v : null;
  return { min: finite(n.minValue), max: finite(n.maxValue), int: n.isInt === true };
}

export function stringInfo(schema: z.ZodType): { maxLength: number | null; format: string | null } {
  const s = schema as unknown as { maxLength?: number | null; format?: string | null };
  return { maxLength: s.maxLength ?? null, format: s.format ?? null };
}

/** A blank value that has the right shape (used when adding list items / enabling a group). */
export function defaultFor(schema: z.ZodType): unknown {
  const u = unwrap(schema);
  if (u.defaultValue !== undefined) return structuredClone(u.defaultValue);
  if (u.nullable) return null;
  if (u.optional) return undefined;
  return blankFor(u.schema);
}

/** Blank value for the unwrapped schema (ignores nullable — used when a null group is enabled). */
export function blankFor(schema: z.ZodType): unknown {
  switch (kindOf(schema)) {
    case 'localized':
      return { ar: '' };
    case 'object':
      return Object.fromEntries(
        Object.entries(objectShape(schema)).flatMap(([k, s]) => {
          const v = defaultFor(s);
          return v === undefined ? [] : [[k, v]];
        }),
      );
    case 'array':
      return [];
    case 'enum':
      return enumValues(schema)[0] ?? '';
    case 'literal':
      return defOf(schema).values?.[0] ?? null;
    case 'number': {
      const { min } = numberBounds(schema);
      return min !== null && min > 0 ? min : 0;
    }
    case 'boolean':
      return false;
    default:
      return '';
  }
}

/** "maxOpenOrdersPerCustomer" → "Max open orders per customer" (fallback label). */
export function humanize(key: string): string {
  const words = key
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Label-map key for a value path: numeric indices are dropped ("store.branches.0.name" → "store.branches.name"). */
export function labelKey(path: (string | number)[]): string {
  return path.filter((p) => typeof p === 'string').join('.');
}

export const pathKey = (path: readonly PropertyKey[]): string => path.map(String).join('.');

export interface FieldIssue {
  path: string;
  code: string;
  minimum?: number;
  maximum?: number;
  message: string;
}

/** Flatten validation issues by path (first issue per path wins). */
export function issuesByPath(error: z.ZodError | undefined): Record<string, FieldIssue> {
  const out: Record<string, FieldIssue> = {};
  for (const issue of error?.issues ?? []) {
    const key = pathKey(issue.path);
    if (out[key]) continue;
    const bounds = issue as { minimum?: number | bigint; maximum?: number | bigint };
    out[key] = {
      path: key,
      code: issue.code,
      minimum: bounds.minimum === undefined ? undefined : Number(bounds.minimum),
      maximum: bounds.maximum === undefined ? undefined : Number(bounds.maximum),
      message: issue.message,
    };
  }
  return out;
}

/** Drop blank optional English translations and keep Arabic-first bilingual values tidy. */
export function cleanLocalized(value: { ar: string; en?: string }): { ar: string; en?: string } {
  const ar = value.ar;
  const en = value.en?.trim() ? value.en : undefined;
  return en === undefined ? { ar } : { ar, en };
}
