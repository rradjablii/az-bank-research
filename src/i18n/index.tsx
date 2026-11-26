import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { en } from './en';
import { az } from './az';
import { v2 } from './v2';
import { formatters, type Lang } from '../lib/format';

const pick = (i: 0 | 1) => Object.fromEntries(Object.entries(v2).map(([k, v]) => [k, v[i]])) as Record<keyof typeof v2, string>;
const dictionaries = { en: { ...en, ...pick(0) }, az: { ...az, ...pick(1) } };
export type MessageKey = keyof typeof en | keyof typeof v2;

export function translate(lang: Lang, key: MessageKey, vars: Record<string, string | number> = {}): string {
  return (dictionaries[lang][key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? `{${name}}`));
}

interface I18n {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  f: ReturnType<typeof formatters>;
}

const Context = createContext<I18n | null>(null);

export function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: preference lasts for this visit only */
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => {
    const saved = readPref('lang');
    if (saved === 'en' || saved === 'az') return saved;
    return navigator.language?.toLowerCase().startsWith('az') ? 'az' : 'en';
  });
  useEffect(() => {
    document.documentElement.lang = lang;
    writePref('lang', lang);
  }, [lang]);
  const value = useMemo<I18n>(() => ({ lang, setLang, t: (k, v) => translate(lang, k, v), f: formatters(lang) }), [lang]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(Context);
  if (!value) throw new Error('I18nProvider missing');
  return value;
}
