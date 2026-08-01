import { useState, useCallback } from 'react';
import { t as translate, tRaw, setLocale as setI18nLocale, getLocale, type Locale, LOCALES, LOCALE_LABELS } from '../i18n';

/**
 * React hook to trigger re-render when locale changes.
 * `t` is stable across renders for a given locale so effect deps do not thrash.
 */
export function useI18n() {
  const [locale, setLocaleState] = useState<Locale>(getLocale());

  const setLocale = useCallback((l: Locale) => {
    setI18nLocale(l);
    setLocaleState(l);
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => translate(key, vars),
    [locale],
  );

  return {
    locale,
    setLocale,
    t,
    tRaw,
    locales: LOCALES,
    localeLabels: LOCALE_LABELS,
  };
}
