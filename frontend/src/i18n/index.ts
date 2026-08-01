/**
 * Frontend i18n — loads translation JSON, provides t() with {{var}} interpolation.
 * Locale is stored in localStorage and broadcast to the backend via Accept-Language.
 */
import ptBR from './pt-BR.json';
import es from './es.json';
import en from './en.json';

export type Locale = 'pt-BR' | 'es' | 'en';
const STORAGE_KEY = 'clinica-tanah-locale';
const DEFAULT: Locale = 'pt-BR';

const dictionaries: Record<Locale, any> = {
  'pt-BR': ptBR,
  'es': es,
  'en': en,
};

let currentLocale: Locale = (typeof localStorage !== 'undefined' && (localStorage.getItem(STORAGE_KEY) as Locale)) || DEFAULT;

export function getLocale(): Locale { return currentLocale; }

export function setLocale(locale: Locale): void {
  currentLocale = locale;
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, locale);
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
}

export function t(key: string, vars: Record<string, string | number> = {}): string {
  const dict = dictionaries[currentLocale] || dictionaries[DEFAULT];
  const parts = key.split('.');
  let cur: any = dict;
  for (const part of parts) {
    if (cur && typeof cur === 'object' && part in cur) cur = cur[part];
    else { cur = key; break; }
  }
  let s = typeof cur === 'string' ? cur : key;
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{{${k}}}`, String(v));
  return s;
}

/**
 * Resolve a key to its raw value (string | array | object), or null when
 * missing. Useful for structured content such as step-by-step lists.
 */
export function tRaw(key: string): any {
  const dict = dictionaries[currentLocale] || dictionaries[DEFAULT];
  const parts = key.split('.');
  let cur: any = dict;
  for (const part of parts) {
    if (cur && typeof cur === 'object' && part in cur) cur = cur[part];
    else return null;
  }
  return cur;
}

export const LOCALES: Locale[] = ['pt-BR', 'es', 'en'];
export const LOCALE_LABELS: Record<Locale, string> = {
  'pt-BR': 'Português',
  'es': 'Español',
  'en': 'English',
};
