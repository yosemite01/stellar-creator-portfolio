import { describe, expect, it } from 'vitest';
import {
  assertSafeMessageKey,
  detectBrowserLocale,
  escapeInterpolationValue,
  flattenMessageKeys,
  formatLocalizedCurrency,
  formatLocalizedDate,
  interpolate,
  isRtlLocale,
  isSupportedLocale,
  translateFromMessages,
} from '@/lib/i18n';

describe('i18n utilities', () => {
  it('detects RTL for Arabic', () => {
    expect(isRtlLocale('ar')).toBe(true);
    expect(isRtlLocale('en')).toBe(false);
  });

  it('validates supported locales', () => {
    expect(isSupportedLocale('en')).toBe(true);
    expect(isSupportedLocale('xx')).toBe(false);
  });

  it('rejects unsafe translation keys', () => {
    expect(() => assertSafeMessageKey('__proto__.polluted')).toThrow();
    expect(() => assertSafeMessageKey('a.__proto__.b')).toThrow();
  });

  it('interpolates named placeholders safely', () => {
    expect(interpolate('Hi {{name}}', { name: 'Ada' })).toBe('Hi Ada');
    expect(interpolate('{{a}} {{b}}', { a: '1', b: '2' })).toBe('1 2');
  });

  it('escapes HTML in interpolation values', () => {
    expect(escapeInterpolationValue('<script>')).not.toContain('<script>');
    expect(escapeInterpolationValue('<script>')).toContain('&lt;');
  });

  it('translateFromMessages resolves nested keys', () => {
    const messages = { nav: { home: 'Home' } } as Record<string, unknown>;
    expect(translateFromMessages(messages, 'nav.home')).toBe('Home');
    expect(translateFromMessages(messages, 'nav.missing')).toBe('nav.missing');
  });

  it('flattenMessageKeys lists leaf paths', () => {
    const obj = { a: { b: 'x', c: { d: 'y' } } } as Record<string, unknown>;
    expect(flattenMessageKeys(obj)).toEqual(['a.b', 'a.c.d']);
  });

  it('formats dates and currency with Intl', () => {
    const d = new Date(Date.UTC(2024, 5, 15, 12, 0, 0));
    expect(formatLocalizedDate(d, 'en-US', { timeZone: 'UTC' })).toMatch(/2024/);
    expect(formatLocalizedCurrency(1234.5, 'USD', 'en-US')).toMatch(/1/);
  });

  it('detectBrowserLocale falls back to English in jsdom', () => {
    expect(detectBrowserLocale()).toBe('en');
  });
});
