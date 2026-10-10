import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AR } from './i18n-ar';

// UI localisation. English is the source language: every UI string is written in English and wrapped in t(),
// and the Arabic dictionary is keyed by that English phrase (a missing entry simply falls back to English).
// Only UI labels are translated — canonical DB values (stage keys, outcome keys, …) never change.
export type Lang = 'en' | 'ar';
export const LANG_KEY = 'accord-lang';
export const LANGS: { key: Lang; label: string; native: string }[] = [
  { key: 'en', label: 'English', native: 'English' },
  { key: 'ar', label: 'Arabic', native: 'العربية' },
];

const readLang = (): Lang => {
  try { return localStorage.getItem(LANG_KEY) === 'ar' ? 'ar' : 'en'; } catch { return 'en'; }
};
let current: Lang = typeof window === 'undefined' ? 'en' : readLang();
export const currentLang = (): Lang => current;
/** BCP-47 locale for Intl formatting; Arabic keeps Latin digits for phone/number/date legibility in operations. */
export const intlLocale = (): string => (current === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB');

/** Translate an English UI phrase. `{name}` placeholders are filled from vars. */
export function t(phrase: string, vars?: Record<string, string | number | null | undefined>): string {
  let s = current === 'ar' ? (AR[phrase] ?? phrase) : phrase;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(v === null || v === undefined ? '' : String(v));
  return s;
}

/** Like t(), but placeholder values are rendered bold (for summary sentences with figures). */
export function tb(phrase: string, vars: Record<string, ReactNode>): ReactNode[] {
  const s = current === 'ar' ? (AR[phrase] ?? phrase) : phrase;
  return s.split(/\{(\w+)\}/).map((part, i) => (i % 2 ? <b key={i}>{vars[part]}</b> : part));
}

function applyDoc(l: Lang) {
  const root = document.documentElement;
  root.setAttribute('lang', l);
  root.setAttribute('dir', l === 'ar' ? 'rtl' : 'ltr');
}

interface I18nState { lang: Lang; dir: 'ltr' | 'rtl'; setLang: (l: Lang) => void; t: typeof t }
const Ctx = createContext<I18nState | null>(null);
export const useI18n = (): I18nState => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useI18n outside I18nProvider');
  return c;
};

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(current);
  current = lang;
  useEffect(() => { applyDoc(lang); }, [lang]);
  const setLang = useCallback((l: Lang) => {
    current = l;
    try { localStorage.setItem(LANG_KEY, l); } catch { /* ignore */ }
    setLangState(l);
  }, []);
  const value = useMemo<I18nState>(() => ({ lang, dir: lang === 'ar' ? 'rtl' : 'ltr', setLang, t }), [lang, setLang]);
  // No remount on a language switch: open dialogs, form drafts and notes keep their state. The components that own
  // the long-lived subtrees (App, CallProvider) subscribe via useI18n(), so their whole subtree re-renders in place
  // and every t() / locRecord label is re-evaluated in the new language.
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Marker the database appends to a deleted user's name (migration 11); shown localized in the UI. */
export const DELETED_SUFFIX = ' (Deleted user)';
/** A person's name as stored, with the "(Deleted user)" marker translated. */
export function personName(name?: string | null): string {
  if (!name) return '';
  return name.endsWith(DELETED_SUFFIX) ? `${name.slice(0, -DELETED_SUFFIX.length)} (${t('Deleted user')})` : name;
}

/** Read-only record whose values are translated on access (keys stay canonical). */
export function locRecord<K extends string>(src: Record<K, string>): Record<K, string> {
  return new Proxy(src, { get: (o, k) => (typeof k === 'string' && k in o ? t(o[k as K]) : undefined) }) as Record<K, string>;
}
/** [canonicalKey, label] pairs whose labels are translated on access. */
export function locPairs(src: [string, string][]): [string, string][] {
  return new Proxy(src, {
    get: (o, k, r) => (typeof k === 'string' && /^\d+$/.test(k) && o[Number(k)] ? [o[Number(k)][0], t(o[Number(k)][1])] : Reflect.get(o, k, r)),
  });
}
