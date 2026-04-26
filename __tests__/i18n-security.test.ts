import { describe, expect, it } from 'vitest';
import { escapeInterpolationValue, interpolate, translateFromMessages } from '@/lib/i18n';

describe('i18n security (translation injection)', () => {
  it('does not pass through raw angle brackets from params', () => {
    const malicious = '<img src=x onerror=alert(1)>';
    const out = interpolate('Hello {{name}}', { name: malicious });
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;');
  });

  it('translateFromMessages only uses JSON string leaves', () => {
    const messages = {
      x: { y: 'v' },
      z: 123,
    } as Record<string, unknown>;
    expect(translateFromMessages(messages, 'x.y')).toBe('v');
    expect(translateFromMessages(messages, 'z')).toBe('z');
  });

  it('escapeInterpolationValue neutralizes quotes', () => {
    expect(escapeInterpolationValue(`"'`)).toContain('&quot;');
    expect(escapeInterpolationValue(`"'`)).toContain('&#39;');
  });
});
