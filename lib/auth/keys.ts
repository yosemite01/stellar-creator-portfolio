import { promises as fs } from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { promisify } from 'util';
import * as crypto from 'crypto';

const exec = promisify(require('child_process').exec);

const KEYS_DIR = path.join(process.cwd(), '.auth-keys');
const PRIVATE_KEY_PATH = path.join(KEYS_DIR, 'auth-private-key.pem');
const PUBLIC_KEY_PATH = path.join(KEYS_DIR, 'auth-public-key.pem');

/**
 * Generate RSA key pair for JWT signing
 * @returns Promise<void>
 */
export async function generateKeys(): Promise<void> {
  // Create keys directory if it doesn't exist
  await fs.mkdir(KEYS_DIR, { recursive: true });

  const privateKey = crypto.generateKeySync('rsa', {
    modulusLength: 2048,
    publicExponent: 65537,
  });

  const privateKeyPem = crypto.exportKey('PEM', privateKey);
  const publicKeyPem = crypto.exportKey('SPKI', privateKey);

  await fs.writeFile(PRIVATE_KEY_PATH, privateKeyPem);
  await fs.writeFile(PUBLIC_KEY_PATH, publicKeyPem);

  console.log('RSA keys generated successfully');
}

/**
 * Load private key for JWT signing
 * @returns crypto.KeyObject
 */
export function loadPrivateKey(): crypto.KeyObject {
  const privateKeyPem = fs.readFileSync(PRIVATE_KEY_PATH, 'utf8');
  return crypto.createPrivateKey(privateKeyPem);
}

/**
 * Load public key for JWT verification
 * @returns crypto.KeyObject
 */
export function loadPublicKey(): crypto.KeyObject {
  const publicKeyPem = fs.readFileSync(PUBLIC_KEY_PATH, 'utf8');
  return crypto.createPublicKey(publicKeyPem);
}

/**
 * Get key ID for JWKS (based on fingerprint)
 * @returns string
 */
export function getKeyId(): string {
  const publicKeyPem = fs.readFileSync(PUBLIC_KEY_PATH, 'utf8');
  const hash = crypto.createHash('sha256').update(publicKeyPem).digest('hex');
  return hash.substring(0, 16);
}

/**
 * Export public key in JWK format for JWKS endpoint
 * @returns object
 */
export function exportJWK(): object {
  const publicKey = loadPublicKey();
  const jwk = crypto.exportKey('jwk', publicKey);
  jwk.kid = getKeyId();
  jwk.use = 'sig';
  return jwk;
}
