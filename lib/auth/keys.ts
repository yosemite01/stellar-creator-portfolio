import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import * as crypto from 'crypto';

const KEYS_DIR = path.join(process.cwd(), '.auth-keys');
const PRIVATE_KEY_PATH = path.join(KEYS_DIR, 'auth-private-key.pem');
const PUBLIC_KEY_PATH = path.join(KEYS_DIR, 'auth-public-key.pem');

/**
 * Generate RSA key pair for JWT signing
 * @returns Promise<void>
 */
export async function generateKeys(): Promise<void> {
  mkdirSync(KEYS_DIR, { recursive: true });

  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicExponent: 65537,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });

  writeFileSync(PRIVATE_KEY_PATH, privateKey, { mode: 0o600 });
  writeFileSync(PUBLIC_KEY_PATH, publicKey);

  console.log('RSA keys generated successfully');
}

/**
 * Load private key for JWT signing
 * @returns crypto.KeyObject
 */
export function loadPrivateKey(): crypto.KeyObject {
  return crypto.createPrivateKey(readFileSync(PRIVATE_KEY_PATH, 'utf8'));
}

/**
 * Load public key for JWT verification
 * @returns crypto.KeyObject
 */
export function loadPublicKey(): crypto.KeyObject {
  return crypto.createPublicKey(readFileSync(PUBLIC_KEY_PATH, 'utf8'));
}

/**
 * Get key ID for JWKS (based on fingerprint)
 * @returns string
 */
export function getKeyId(): string {
  const publicKeyPem = readFileSync(PUBLIC_KEY_PATH, 'utf8');
  return crypto.createHash('sha256').update(publicKeyPem).digest('hex').substring(0, 16);
}

/**
 * Export public key in JWK format for JWKS endpoint
 */
export function exportJWK(): crypto.JsonWebKey & { kid: string; use: string } {
  const jwk = loadPublicKey().export({ format: 'jwk' });
  return { ...jwk, kid: getKeyId(), use: 'sig' };
}
