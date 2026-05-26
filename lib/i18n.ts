/**
 * Internationalization utilities: locales, safe interpolation, and Intl formatters.
 * Translation JSON lives in `public/locales/{locale}.json` (nested keys, dot paths).
 */

export const DEFAULT_LOCALE = 'en' as const;

export const LOCALE_COOKIE = 'NEXT_LOCALE';
export const LOCALE_STORAGE_KEY = 'stellar_locale';

export const SUPPORTED_LOCALES = ['en', 'es', 'fr', 'de', 'ar'] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

export type LocaleInfo = {
  code: AppLocale;
  /** English label for the switcher */
  label: string;
  /** Native name */
  nativeLabel: string;
  rtl: boolean;
};

export const LOCALE_INFO: Record<AppLocale, LocaleInfo> = {
  en: { code: 'en', label: 'English', nativeLabel: 'English', rtl: false },
  es: { code: 'es', label: 'Spanish', nativeLabel: 'Español', rtl: false },
  fr: { code: 'fr', label: 'French', nativeLabel: 'Français', rtl: false },
  de: { code: 'de', label: 'German', nativeLabel: 'Deutsch', rtl: false },
  ar: { code: 'ar', label: 'Arabic', nativeLabel: 'العربية', rtl: true },
};

export function isRtlLocale(locale: string): boolean {
  const info = LOCALE_INFO[locale as AppLocale];
  return info?.rtl ?? false;
}

export function isSupportedLocale(code: string): code is AppLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(code);
}

/** Reject prototype / __proto__ style paths (translation injection hardening). */
export function assertSafeMessageKey(key: string): void {
  if (!key || key.length > 512) {
    throw new Error('Invalid translation key');
  }
  if (key.includes('__proto__') || key.includes('constructor') || key.includes('prototype')) {
    throw new Error('Invalid translation key');
  }
  for (const segment of key.split('.')) {
    if (segment.startsWith('__')) {
      throw new Error('Invalid translation key');
    }
  }
}

/** Escape text used inside translated strings (defense in depth; React still escapes JSX). */
export function escapeInterpolationValue(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function getByPath(obj: unknown, path: string): unknown {
  assertSafeMessageKey(path);
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined || typeof cur !== 'object') {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

export function interpolate(
  template: string,
  params?: Record<string, string | number>,
): string {
  if (!params) return template;
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, name: string) => {
    const v = params[name];
    if (v === undefined || v === null) return '';
    const s = typeof v === 'number' ? String(v) : escapeInterpolationValue(v);
    return s;
  });
}

export function translateFromMessages(
  messages: Record<string, unknown>,
  key: string,
  params?: Record<string, string | number>,
): string {
  assertSafeMessageKey(key);
  const raw = getByPath(messages, key);
  if (typeof raw !== 'string') {
    return key;
  }
  return interpolate(raw, params);
}

/** Flatten nested JSON for key-parity checks (community / CI tooling). */
export function flattenMessageKeys(
  obj: Record<string, unknown>,
  prefix = '',
): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith('__')) continue;
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...flattenMessageKeys(v as Record<string, unknown>, path));
    } else {
      out.push(path);
    }
  }
  return out.sort();
}

export async function loadLocaleMessages(
  locale: AppLocale,
  basePath = '/locales',
): Promise<Record<string, unknown>> {
  const res = await fetch(`${basePath}/${locale}.json`, {
    credentials: 'same-origin',
    cache: 'force-cache',
  });
  if (!res.ok) {
    throw new Error(`Failed to load locale ${locale}: ${res.status}`);
  }
  const data = (await res.json()) as unknown;
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`Invalid locale bundle: ${locale}`);
  }
  return data as Record<string, unknown>;
}

export function detectBrowserLocale(): AppLocale {
  if (typeof navigator === 'undefined') return DEFAULT_LOCALE;
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const l of langs) {
    const base = l.split('-')[0]?.toLowerCase();
    if (base && isSupportedLocale(base)) {
      return base;
    }
  }
  return DEFAULT_LOCALE;
}

export function readLocaleFromStorage(): AppLocale | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (v && isSupportedLocale(v)) return v;
  } catch {
    /* ignore */
  }
  return null;
}

export function readLocaleFromCookie(): AppLocale | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]*)`));
  const raw = match?.[1];
  if (!raw) return null;
  try {
    const decoded = decodeURIComponent(raw);
    if (isSupportedLocale(decoded)) return decoded;
  } catch {
    /* ignore */
  }
  return null;
}

export function persistLocaleChoice(locale: AppLocale): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    /* ignore */
  }
  const maxAge = 60 * 60 * 24 * 365;
  document.cookie = `${LOCALE_COOKIE}=${encodeURIComponent(locale)};path=/;max-age=${maxAge};SameSite=Lax`;
}

export function resolveInitialLocale(): AppLocale {
  const fromCookie = readLocaleFromCookie();
  if (fromCookie) return fromCookie;
  const fromStorage = readLocaleFromStorage();
  if (fromStorage) return fromStorage;
  return detectBrowserLocale();
}

export type DateFormatStyle = 'short' | 'medium' | 'long' | 'full';

export function formatLocalizedDate(
  date: Date | number,
  locale: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  const d = typeof date === 'number' ? new Date(date) : date;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    ...options,
  }).format(d);
}

export function formatLocalizedCurrency(
  amount: number,
  currency: string,
  locale: string,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    ...options,
  }).format(amount);
}

export function formatLocalizedNumber(
  value: number,
  locale: string,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(locale, options).format(value);
}
