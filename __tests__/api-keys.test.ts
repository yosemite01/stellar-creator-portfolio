import { describe, it, expect } from 'vitest';
import {
  generateApiKey,
  hashApiKey,
  parseScopes,
  verifyApiKey,
  isApiKeyExpired,
  API_KEY_SCOPES,
  DEFAULT_API_KEY_TTL_MS,
  parseApiKey,
} from '@/lib/api-keys';

describe('API key utilities', () => {
  it('generates keys in the sk_live_<prefix>_<secret> shape', () => {
    const { rawKey, keyHash, prefix } = generateApiKey();
    expect(rawKey).toMatch(/^sk_live_[a-f0-9]{16}_[a-f0-9]{48}$/);
    expect(rawKey.startsWith(`sk_live_${prefix}_`)).toBe(true);
    expect(keyHash).toHaveLength(64);
  });

  it('parses a generated key and rejects malformed ones', () => {
    const { rawKey, prefix } = generateApiKey();
    expect(parseApiKey(rawKey)).toEqual({ prefix, secret: rawKey.split('_').pop() });
    expect(parseApiKey('sk_deadbeef')).toBeNull();
    expect(parseApiKey('sk_live_zz_11')).toBeNull();
  });

  it('defaults new keys to a 90-day expiry', () => {
    const before = Date.now();
    const { expiresAt } = generateApiKey();
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + DEFAULT_API_KEY_TTL_MS);
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

  it('never stores plaintext: stored hash is the hash of the secret part', () => {
    const { rawKey, keyHash } = generateApiKey();
    expect(keyHash).not.toBe(rawKey);
    expect(keyHash).toBe(hashApiKey(parseApiKey(rawKey)!.secret));
  });

  it('verifies a matching secret and rejects a mismatched one', () => {
    const { rawKey, keyHash } = generateApiKey();
    expect(verifyApiKey(parseApiKey(rawKey)!.secret, keyHash)).toBe(true);
    expect(verifyApiKey('deadbeef', keyHash)).toBe(false);
  });

  it('rejects verification against a malformed stored hash', () => {
    const { rawKey } = generateApiKey();
    expect(verifyApiKey(rawKey, 'not-a-hash')).toBe(false);
  });

  it('treats keys without expiry as expired (deny by default, forces rotation)', () => {
    expect(isApiKeyExpired(null)).toBe(true);
    expect(isApiKeyExpired(undefined)).toBe(true);
  });

  it('detects expired keys', () => {
    const past = new Date(Date.now() - 1000);
    const future = new Date(Date.now() + 1000);
    expect(isApiKeyExpired(past)).toBe(true);
    expect(isApiKeyExpired(future)).toBe(false);
  });

  it('exposes a deny-by-default scope enum', () => {
    expect(API_KEY_SCOPES).toContain('read-only');
    expect(API_KEY_SCOPES).toContain('read-write');
    expect(API_KEY_SCOPES).not.toContain('admin');
  });
});
