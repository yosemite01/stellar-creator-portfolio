import { createHash, randomBytes } from 'crypto';

export const API_KEY_PREFIX = 'sk_';

export function generateApiKey(): { rawKey: string; keyHash: string } {
  const rawKey = `${API_KEY_PREFIX}${randomBytes(24).toString('hex')}`;
  const keyHash = hashApiKey(rawKey);
  return { rawKey, keyHash };
}

export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

export type ApiKeyScope = 'read-only' | 'read-write';

export function parseScopes(scopes: string[]): ApiKeyScope[] {
  return scopes.filter((s): s is ApiKeyScope => s === 'read-only' || s === 'read-write');
}
