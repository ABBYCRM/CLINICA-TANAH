/**
 * i18n service — load translations and resolve dotted keys with {{var}} interpolation.
 */
import fs from 'fs';
import path from 'path';

export type Locale = 'pt-BR' | 'es' | 'en';

const LOCALES: Locale[] = ['pt-BR', 'es', 'en'];
const DEFAULT_LOCALE: Locale = 'pt-BR';

const cache: Partial<Record<Locale, any>> = {};

function load(locale: Locale): any {
  if (cache[locale]) return cache[locale];
  const p = path.join(__dirname, '..', 'i18n', `${locale}.json`);
  const raw = fs.readFileSync(p, 'utf-8');
  cache[locale] = JSON.parse(raw);
  return cache[locale];
}

export function t(locale: Locale, key: string, vars: Record<string, string | number> = {}): string {
  const dict = load(locale) || load(DEFAULT_LOCALE);
  const parts = key.split('.');
  let cur: any = dict;
  for (const part of parts) {
    if (cur && typeof cur === 'object' && part in cur) cur = cur[part];
    else { cur = key; break; }
  }
  let s = typeof cur === 'string' ? cur : key;
  for (const [k, v] of Object.entries(vars)) {
    s = s.replaceAll(`{{${k}}}`, String(v));
  }
  return s;
}

export function detectLocale(input?: string | null): Locale {
  if (!input) return DEFAULT_LOCALE;
  const lc = input.toLowerCase();
  if (lc.startsWith('pt')) return 'pt-BR';
  if (lc.startsWith('es')) return 'es';
  if (lc.startsWith('en')) return 'en';
  return DEFAULT_LOCALE;
}

export function availableLocales(): Locale[] { return LOCALES; }
