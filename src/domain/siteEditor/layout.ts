import type { z } from 'zod';
import {
  SECTION_PROP_SCHEMAS,
  isSectionType,
  sectionDesignSchema,
} from '@/domain/content/sections';
import {
  MAX_PROPS_BYTES,
  MAX_SECTIONS,
  SECTION_KEY_RE,
  type LayoutProblem,
  type LayoutSection,
} from './schemas';

/**
 * Pure layout operations used by the editor (and its undo history). Every function returns a new
 * array; inputs are never mutated.
 */

export function moveSection(list: LayoutSection[], from: number, to: number): LayoutSection[] {
  if (from === to || from < 0 || from >= list.length) return list;
  const target = Math.max(0, Math.min(list.length - 1, to));
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (!item) return list;
  next.splice(target, 0, item);
  return next;
}

export function moveSectionBy(list: LayoutSection[], key: string, delta: number) {
  const index = list.findIndex((s) => s.key === key);
  return index < 0 ? list : moveSection(list, index, index + delta);
}

/** A key not used in `list`: `base`, `base-2`, `base-3`… (kept within the 60-char slug limit). */
export function uniqueKey(list: readonly { key: string }[], base: string): string {
  const clean =
    base
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 52) || 'section';
  const used = new Set(list.map((s) => s.key));
  if (!used.has(clean)) return clean;
  for (let n = 2; ; n += 1) {
    const candidate = `${clean}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

export function duplicateSection(list: LayoutSection[], key: string) {
  const index = list.findIndex((s) => s.key === key);
  const source = list[index];
  if (!source) return { list, key: null };
  const copy: LayoutSection = {
    ...structuredClone(source),
    key: uniqueKey(list, `${source.key}-copy`),
  };
  const next = [...list];
  next.splice(index + 1, 0, copy);
  return { list: next, key: copy.key };
}

export function insertSection(list: LayoutSection[], section: LayoutSection, index = list.length) {
  const next = [...list];
  next.splice(Math.max(0, Math.min(index, list.length)), 0, section);
  return next;
}

export function removeSection(list: LayoutSection[], key: string) {
  return list.filter((s) => s.key !== key);
}

export function updateSection(
  list: LayoutSection[],
  key: string,
  patch: Partial<Omit<LayoutSection, 'key' | 'type'>>,
) {
  return list.map((s) => (s.key === key ? { ...s, ...patch } : s));
}

export interface LayoutIssue {
  code: LayoutProblem;
  key: string | null;
  /** Per-field problems for invalid props (zod issues against SECTION_PROP_SCHEMAS). */
  issues?: z.core.$ZodIssue[];
}

/** Client-side mirror of app.validate_page_layout plus per-type prop validation. */
export function validateLayout(list: LayoutSection[]): LayoutIssue[] {
  const problems: LayoutIssue[] = [];
  if (list.length > MAX_SECTIONS) problems.push({ code: 'too_many_sections', key: null });
  const seen = new Set<string>();
  for (const section of list) {
    if (!SECTION_KEY_RE.test(section.key)) {
      problems.push({ code: 'invalid_key', key: section.key });
      continue;
    }
    if (seen.has(section.key)) problems.push({ code: 'duplicate_key', key: section.key });
    seen.add(section.key);
    if (!isSectionType(section.type)) {
      problems.push({ code: 'unknown_type', key: section.key });
      continue;
    }
    const parsed = SECTION_PROP_SCHEMAS[section.type].safeParse(section.props);
    if (!parsed.success || JSON.stringify(section.props).length > MAX_PROPS_BYTES)
      problems.push({
        code: 'invalid_props',
        key: section.key,
        issues: parsed.success ? [] : parsed.error.issues,
      });
    if (section.design && !sectionDesignSchema.safeParse(section.design).success)
      problems.push({ code: 'invalid_design', key: section.key });
  }
  return problems;
}

const SECTION_DESIGN_KEYS = new Set(['background', 'spacing']);

/**
 * Exact mirror of app.validate_page_layout (structure only; per-type props are checked by the
 * editor with validateLayout). Used by the demo engine so both modes refuse the same layouts.
 */
export function structuralProblem(value: unknown): LayoutProblem | null {
  if (!Array.isArray(value)) return 'invalid_layout';
  if (value.length > MAX_SECTIONS) return 'too_many_sections';
  const keys = new Set<string>();
  for (const item of value as unknown[]) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return 'invalid_layout';
    const s = item as Record<string, unknown>;
    if (typeof s.key !== 'string' || !SECTION_KEY_RE.test(s.key)) return 'invalid_key';
    if (keys.has(s.key)) return 'duplicate_key';
    keys.add(s.key);
    if (typeof s.type !== 'string' || !isSectionType(s.type)) return 'unknown_type';
    if (typeof s.isVisible !== 'boolean') return 'invalid_layout';
    if (
      !s.props ||
      typeof s.props !== 'object' ||
      Array.isArray(s.props) ||
      JSON.stringify(s.props).length > MAX_PROPS_BYTES
    )
      return 'invalid_props';
    const design = s.design ?? {};
    if (typeof design !== 'object' || Array.isArray(design) || design === null)
      return 'invalid_design';
    const d = design as Record<string, unknown>;
    if (
      Object.keys(d).some((k) => !SECTION_DESIGN_KEYS.has(k)) ||
      !['default', 'muted', 'dark', 'brand', undefined].includes(
        (d.background ?? undefined) as string,
      ) ||
      !['compact', 'default', 'relaxed', undefined].includes((d.spacing ?? undefined) as string)
    )
      return 'invalid_design';
  }
  return null;
}

/** Stable comparison (key order of props does not matter). */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}

function normalizedDesign(design: LayoutSection['design']) {
  const d = { ...(design ?? {}) };
  if (d.background === 'default') delete d.background;
  if (d.spacing === 'default') delete d.spacing;
  return d;
}

export function sameSection(a: LayoutSection, b: LayoutSection) {
  return (
    a.key === b.key &&
    a.type === b.type &&
    a.isVisible === b.isVisible &&
    JSON.stringify(canonical(a.props)) === JSON.stringify(canonical(b.props)) &&
    JSON.stringify(canonical(normalizedDesign(a.design))) ===
      JSON.stringify(canonical(normalizedDesign(b.design)))
  );
}

export function sameLayout(a: readonly LayoutSection[], b: readonly LayoutSection[]) {
  return a.length === b.length && a.every((s, i) => b[i] !== undefined && sameSection(s, b[i]));
}

export type LayoutChange = 'added' | 'removed' | 'moved' | 'edited' | 'hidden' | 'shown';

export interface LayoutDiffRow {
  key: string;
  type: string;
  /** 1-based positions (null when absent on that side). */
  from: number | null;
  to: number | null;
  changes: LayoutChange[];
}

/** Section-level comparison of two layouts (version compare, publish summary). */
export function diffLayouts(
  before: readonly LayoutSection[],
  after: readonly LayoutSection[],
): LayoutDiffRow[] {
  const beforeIndex = new Map(before.map((s, i) => [s.key, i]));
  const afterKeys = new Set(after.map((s) => s.key));
  const keptBefore = before.filter((s) => afterKeys.has(s.key)).map((s) => s.key);
  const keptAfter = after.filter((s) => beforeIndex.has(s.key)).map((s) => s.key);
  const rows: LayoutDiffRow[] = after.map((s, i) => {
    const bi = beforeIndex.get(s.key);
    const prev = bi === undefined ? undefined : before[bi];
    const changes: LayoutChange[] = [];
    if (!prev) changes.push('added');
    else {
      if (keptBefore.indexOf(s.key) !== keptAfter.indexOf(s.key)) changes.push('moved');
      if (prev.isVisible && !s.isVisible) changes.push('hidden');
      if (!prev.isVisible && s.isVisible) changes.push('shown');
      if (!sameSection({ ...prev, isVisible: s.isVisible }, s)) changes.push('edited');
    }
    return {
      key: s.key,
      type: s.type,
      from: bi === undefined ? null : bi + 1,
      to: i + 1,
      changes,
    };
  });
  before.forEach((s, i) => {
    if (!afterKeys.has(s.key))
      rows.push({ key: s.key, type: s.type, from: i + 1, to: null, changes: ['removed'] });
  });
  return rows;
}
