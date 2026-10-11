import { useEffect, useRef } from 'react';
import { supabase } from './supabase';
import { useAuth } from './auth';
import { useTheme, type ThemePref } from './theme';
import { useI18n, type Lang } from './i18n';

// Cross-device appearance/language preferences.
// localStorage stays the source for first paint (index.html boot script). After sign-in the CURRENT values stored in
// the user's own Supabase Auth metadata (user_metadata.accord_theme / accord_lang — writable only by that user, no table
// or schema involved) are fetched and applied; changes made while signed in are written back.
const isPref = (v: unknown): v is ThemePref => v === 'light' || v === 'dark' || v === 'system';
const isLang = (v: unknown): v is Lang => v === 'en' || v === 'ar';
// module-level: survives the subtree remount that a language switch causes
let fetchedFor: string | null = null;  // user whose server value has been requested
let loadedFor: string | null = null;   // user whose server value has arrived (writes allowed from then on)
let known: { p?: unknown; l?: unknown } = {};

function save(p: ThemePref, l: Lang) {
  known = { p, l };
  supabase.auth.updateUser({ data: { accord_theme: p, accord_lang: l } }).catch(() => { /* offline: local value still applies */ });
}

export function PrefsSync() {
  const { session } = useAuth();
  const { pref, setPref } = useTheme();
  const { lang, setLang } = useI18n();
  const uid = session?.user.id ?? null;
  const latest = useRef({ pref, lang });
  latest.current = { pref, lang };

  // 1. after sign-in: fetch the server value once; it wins over this device's local value; seed it if absent
  useEffect(() => {
    if (!uid) { fetchedFor = null; loadedFor = null; known = {}; return; }
    if (fetchedFor === uid) return;
    fetchedFor = uid;
    supabase.auth.getUser().then(({ data }) => {
      if (fetchedFor !== uid || !data.user) return;
      const m = (data.user.user_metadata ?? {}) as { accord_theme?: unknown; accord_lang?: unknown };
      known = { p: m.accord_theme, l: m.accord_lang };
      loadedFor = uid;
      const p = isPref(m.accord_theme) ? m.accord_theme : latest.current.pref;
      const l = isLang(m.accord_lang) ? m.accord_lang : latest.current.lang;
      if (p !== latest.current.pref) setPref(p);
      if (l !== latest.current.lang) setLang(l);
      if (known.p !== p || known.l !== l) save(p, l);
    }).catch(() => { /* offline: keep the local value */ });
  }, [uid, setPref, setLang]);

  // 2. a change made on this device while signed in is written back (only once the server value is known)
  useEffect(() => {
    if (!uid || loadedFor !== uid) return;
    if (known.p !== pref || known.l !== lang) save(pref, lang);
  }, [uid, pref, lang]);
  return null;
}
