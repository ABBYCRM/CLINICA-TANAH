import { useState, useEffect, useCallback } from 'react';
import { t as translate, setLocale as setI18nLocale, getLocale, type Locale, LOCALES, LOCALE_LABELS } from '../i18n';

/**
 * React hook to trigger re-render when locale changes.
 */
export function useI18n() {
  const [locale, setLocaleState] = useState<Locale>(getLocale());

  const setLocale = useCallback((l: Locale) => {
    setI18nLocale(l);
    setLocaleState(l);
  }, []);

  return {
    locale,
    setLocale,
    t: (key: string, vars?: Record<string, string | number>) => translate(key, vars),
    locales: LOCALES,
    localeLabels: LOCALE_LABELS,
  };
}
