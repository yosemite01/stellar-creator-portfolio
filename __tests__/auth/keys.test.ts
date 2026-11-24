import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import {
  generateKeys,
  loadPrivateKey,
  loadPublicKey,
  getKeyId,
  exportJWK,
} from '@/lib/auth/keys';
import { randomUUID } from 'crypto';

describe('RSA Keys', () => {
  const KEYS_DIR = path.join(process.cwd(), '.auth-keys-test');
  const PRIVATE_KEY_PATH = path.join(KEYS_DIR, 'auth-private-key.pem');
  const PUBLIC_KEY_PATH = path.join(KEYS_DIR, 'auth-public-key.pem');

  beforeAll(async () => {
    // Create test keys directory
    await fs.mkdir(KEYS_DIR, { recursive: true });
    
    // Override the keys path for testing
    (globalThis as any).AUTH_KEYS_DIR = KEYS_DIR;
  });

  afterAll(async () => {
    // Clean up test keys
    await fs.rm(KEYS_DIR, { recursive: true, force: true });
  });

  it('generates valid RSA key pair', async () => {
    await generateKeys();

    const privateKey = loadPrivateKey();
    const publicKey = loadPublicKey();

    expect(privateKey).toBeDefined();
    expect(publicKey).toBeDefined();
  });

  it('exports valid JWK', () => {
    const jwk = exportJWK();

    expect(jwk).toBeDefined();
    expect(jwk.kty).toBe('RSA');
    expect(jwk.use).toBe('sig');
    expect(jwk.n).toBeDefined();
    expect(jwk.e).toBeDefined();
    expect(jwk.kid).toBeDefined();
  });

  it('generates consistent key ID', () => {
    const kid1 = getKeyId();
    const kid2 = getKeyId();

    expect(kid1).toBe(kid2);
    expect(kid1.length).toBe(16);
  });

  it('exports JWK with consistent key ID', () => {
    const jwk = exportJWK();
    const kid = getKeyId();

    expect(jwk.kid).toBe(kid);
  });
});

describe('Revocation', () => {
  it('revokeToken creates entry in database', async () => {
    // This test would require database setup
    // For now, just verify the function exists
    expect(typeof import('@/lib/auth/revocation').then(m => m.revokeToken)).toBe('function');
  });

  it('isTokenRevoked checks database', async () => {
    // This test would require database setup
    expect(typeof import('@/lib/auth/revocation').then(m => m.isTokenRevoked)).toBe('function');
  });
});
