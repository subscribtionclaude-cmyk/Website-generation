import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

// Single source of truth for appearance. The preference (light | dark | system) is stored under ONE key;
// the resolved theme is always written to <html data-theme>, so CSS only ever has to read one attribute.
// index.html runs the same resolution before first paint (no flash), this provider takes over after mount.
export type ThemePref = 'light' | 'dark' | 'system';
export type Theme = 'light' | 'dark';
export const THEME_KEY = 'accord-theme';
// browser chrome colour per theme (matches --chrome in index.css)
const CHROME: Record<Theme, string> = { light: '#ffffff', dark: '#0b1428' };

const mq = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null);
const readPref = (): ThemePref => {
  try { const v = localStorage.getItem(THEME_KEY); if (v === 'light' || v === 'dark' || v === 'system') return v; } catch { /* storage blocked */ }
  return 'system';
};
const resolve = (p: ThemePref): Theme => (p === 'system' ? (mq()?.matches ? 'dark' : 'light') : p);

function apply(t: Theme) {
  const root = document.documentElement;
  root.setAttribute('data-theme', t);
  root.style.colorScheme = t;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', CHROME[t]));
  // favicon: official light / dark ACCORD icon
  document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]').forEach((l) => {
    const cur = l.getAttribute('href') ?? '';
    const next = cur.replace(/favicon-(dark-)?(\d+)\.png/, t === 'dark' ? 'favicon-dark-$2.png' : 'favicon-$2.png');
    if (next !== cur) l.setAttribute('href', next);
  });
}

interface ThemeState { pref: ThemePref; theme: Theme; setPref: (p: ThemePref) => void; toggle: () => void }
const Ctx = createContext<ThemeState | null>(null);
export const useTheme = (): ThemeState => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useTheme outside ThemeProvider');
  return c;
};

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>(readPref);
  const [system, setSystem] = useState<Theme>(() => (mq()?.matches ? 'dark' : 'light'));
  const theme: Theme = pref === 'system' ? system : pref;

  useEffect(() => {
    const m = mq(); if (!m) return;
    const on = () => setSystem(m.matches ? 'dark' : 'light');
    m.addEventListener?.('change', on);
    return () => m.removeEventListener?.('change', on);
  }, []);
  useEffect(() => { apply(theme); }, [theme]);
  // keep several open tabs / the installed PWA in sync
  useEffect(() => {
    const on = (e: StorageEvent) => { if (e.key === THEME_KEY) setPrefState(readPref()); };
    window.addEventListener('storage', on);
    return () => window.removeEventListener('storage', on);
  }, []);

  const setPref = useCallback((p: ThemePref) => {
    setPrefState(p);
    try { localStorage.setItem(THEME_KEY, p); } catch { /* ignore */ }
  }, []);
  const value = useMemo<ThemeState>(() => ({
    pref, theme, setPref, toggle: () => setPref(resolve(pref) === 'dark' ? 'light' : 'dark'),
  }), [pref, theme, setPref]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
