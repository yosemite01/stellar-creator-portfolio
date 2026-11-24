import { createHash, randomBytes, timingSafeEqual } from 'crypto';

export const API_KEY_PREFIX = 'sk_live_';

export const API_KEY_SCOPES = ['read-only', 'read-write'] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const DEFAULT_API_KEY_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export interface GeneratedApiKey {
  /** Full key, shown to the user exactly once. Never persisted. */
  rawKey: string;
  /** Public, non-secret identifier used for lookup. */
  prefix: string;
  /** SHA-256 hash of the secret portion. This is what gets stored. */
  keyHash: string;
  scopes: ApiKeyScope[];
  expiresAt: Date;
}

export function generateApiKey(options?: {
  scopes?: ApiKeyScope[];
  expiresAt?: Date;
  ttlMs?: number;
}): GeneratedApiKey {
  const prefix = randomBytes(8).toString('hex');
  const secret = randomBytes(24).toString('hex');
  const rawKey = `${API_KEY_PREFIX}${prefix}_${secret}`;
  const keyHash = hashApiKey(secret);
  const scopes: ApiKeyScope[] =
    options?.scopes && options.scopes.length > 0 ? options.scopes : ['read-only'];
  const expiresAt =
    options?.expiresAt ?? new Date(Date.now() + (options?.ttlMs ?? DEFAULT_API_KEY_TTL_MS));
  return { rawKey, prefix, keyHash, scopes, expiresAt };
}

/**
 * Splits a presented key into its prefix and secret. Returns null for
 * anything that does not match the `sk_live_<prefix>_<secret>` shape so
 * callers can deny-by-default on malformed input.
 */
export function parseApiKey(rawKey: string): { prefix: string; secret: string } | null {
  if (typeof rawKey !== 'string' || !rawKey.startsWith(API_KEY_PREFIX)) return null;
  const rest = rawKey.slice(API_KEY_PREFIX.length);
  const sep = rest.indexOf('_');
  if (sep <= 0 || sep === rest.length - 1) return null;
  const prefix = rest.slice(0, sep);
  const secret = rest.slice(sep + 1);
  if (!/^[0-9a-f]+$/.test(prefix) || !/^[0-9a-f]+$/.test(secret)) return null;
  return { prefix, secret };
}

export function hashApiKey(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/** Constant-time comparison of a presented secret against a stored hash. */
export function verifyApiKey(secret: string, storedHash: string): boolean {
  const presented = Buffer.from(hashApiKey(secret), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  if (presented.length !== stored.length) return false;
  return timingSafeEqual(presented, stored);
}

export function isApiKeyExpired(expiresAt: Date | null | undefined, now: Date = new Date()): boolean {
  if (!expiresAt) return true;
  return expiresAt.getTime() <= now.getTime();
}

export function parseScopes(scopes: string[]): ApiKeyScope[] {
  return scopes.filter((s): s is ApiKeyScope =>
    (API_KEY_SCOPES as readonly string[]).includes(s),
  );
}
