import { describe, it, expect } from 'vitest';
import { generateApiKey, hashApiKey, parseScopes } from '@/lib/api-keys';

describe('API key utilities', () => {
  it('generates keys with sk_ prefix', () => {
    const { rawKey, keyHash } = generateApiKey();
    expect(rawKey).toMatch(/^sk_[a-f0-9]{48}$/);
    expect(keyHash).toHaveLength(64);
  });

  it('hashes keys consistently', () => {
    const key = 'sk_test123';
    expect(hashApiKey(key)).toBe(hashApiKey(key));
  });

  it('parses valid scopes', () => {
    expect(parseScopes(['read-only', 'read-write', 'invalid'])).toEqual([
      'read-only',
      'read-write',
    ]);
  });

  it('rejects empty scope list after parsing', () => {
    expect(parseScopes(['admin'])).toEqual([]);
  });
});
