'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  DEFAULT_LOCALE,
  type AppLocale,
  isRtlLocale,
  isSupportedLocale,
  loadLocaleMessages,
  persistLocaleChoice,
  readLocaleFromCookie,
  readLocaleFromStorage,
  detectBrowserLocale,
  translateFromMessages,
  formatLocalizedDate,
  formatLocalizedCurrency,
  formatLocalizedNumber,
} from '@/lib/i18n';

export type I18nContextValue = {
  locale: AppLocale;
  setLocale: (next: AppLocale) => Promise<void>;
  t: (key: string, params?: Record<string, string | number>) => string;
  formatDate: (date: Date | number, options?: Intl.DateTimeFormatOptions) => string;
  formatCurrency: (amount: number, currency: string, options?: Intl.NumberFormatOptions) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  isRtl: boolean;
  isLoading: boolean;
  messages: Record<string, unknown>;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function resolveClientLocale(): AppLocale {
  const fromCookie = readLocaleFromCookie();
  if (fromCookie) return fromCookie;
  const fromStorage = readLocaleFromStorage();
  if (fromStorage) return fromStorage;
  return detectBrowserLocale();
}

function applyDocumentLanguage(loc: AppLocale): void {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  html.setAttribute('lang', loc);
  html.setAttribute('dir', isRtlLocale(loc) ? 'rtl' : 'ltr');
  html.classList.toggle('rtl', isRtlLocale(loc));
  html.classList.toggle('ltr', !isRtlLocale(loc));
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>(DEFAULT_LOCALE);
  const [messages, setMessages] = useState<Record<string, unknown>>({});
  const [isLoading, setIsLoading] = useState(true);

  const hydrateFromLocale = useCallback(async (loc: AppLocale) => {
    setIsLoading(true);
    try {
      const data = await loadLocaleMessages(loc);
      setMessages(data);
      setLocaleState(loc);
      persistLocaleChoice(loc);
      applyDocumentLanguage(loc);
    } catch {
      const fallback = await loadLocaleMessages(DEFAULT_LOCALE);
      setMessages(fallback);
      setLocaleState(DEFAULT_LOCALE);
      persistLocaleChoice(DEFAULT_LOCALE);
      applyDocumentLanguage(DEFAULT_LOCALE);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const initial = resolveClientLocale();
      const loc = isSupportedLocale(initial) ? initial : DEFAULT_LOCALE;
      setIsLoading(true);
      try {
        const data = await loadLocaleMessages(loc);
        if (cancelled) return;
        setMessages(data);
        setLocaleState(loc);
        persistLocaleChoice(loc);
        applyDocumentLanguage(loc);
      } catch {
        if (cancelled) return;
        try {
          const fallback = await loadLocaleMessages(DEFAULT_LOCALE);
          if (cancelled) return;
          setMessages(fallback);
          setLocaleState(DEFAULT_LOCALE);
          persistLocaleChoice(DEFAULT_LOCALE);
          applyDocumentLanguage(DEFAULT_LOCALE);
        } catch {
          /* ignore */
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const setLocale = useCallback(async (next: AppLocale) => {
    if (next === locale && Object.keys(messages).length > 0) {
      persistLocaleChoice(next);
      applyDocumentLanguage(next);
      return;
    }
    await hydrateFromLocale(next);
  }, [locale, messages, hydrateFromLocale]);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) =>
      translateFromMessages(messages, key, params),
    [messages],
  );

  const formatDate = useCallback(
    (date: Date | number, options?: Intl.DateTimeFormatOptions) =>
      formatLocalizedDate(date, locale, options),
    [locale],
  );

  const formatCurrency = useCallback(
    (amount: number, currency: string, options?: Intl.NumberFormatOptions) =>
      formatLocalizedCurrency(amount, currency, locale, options),
    [locale],
  );

  const formatNumber = useCallback(
    (value: number, options?: Intl.NumberFormatOptions) =>
      formatLocalizedNumber(value, locale, options),
    [locale],
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t,
      formatDate,
      formatCurrency,
      formatNumber,
      isRtl: isRtlLocale(locale),
      isLoading,
      messages,
    }),
    [locale, setLocale, t, formatDate, formatCurrency, formatNumber, isLoading, messages],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return ctx;
}
