/**
 * Field-level encryption for KYC PII (Issue #782).
 *
 * Uses AES-256-GCM with the platform `ENCRYPTION_KEY` secret (resolved via
 * `backend/services/kms`, which transparently uses AWS Secrets Manager in
 * production and the raw env var locally/in CI). Each call generates a
 * fresh random IV; the IV and auth tag are packed alongside the ciphertext
 * so a single opaque string can be stored per field.
 */

import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import { getSecret } from '@/backend/services/kms';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV recommended for GCM

async function getKey(): Promise<Buffer> {
  const secret = await getSecret('ENCRYPTION_KEY');
  // ENCRYPTION_KEY is a 64-char hex string (32 bytes) per .env.example.
  const key = Buffer.from(secret, 'hex');
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must decode to exactly 32 bytes for AES-256-GCM');
  }
  return key;
}

/**
 * Encrypts a plaintext PII value. Returns `iv:authTag:ciphertext`, each
 * base64-encoded, suitable for storing directly in a text column.
 */
export async function encryptField(plaintext: string): Promise<string> {
  const key = await getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(':');
}

/**
 * Decrypts a value produced by `encryptField`. Throws if the auth tag does
 * not verify (tampering or wrong key).
 */
export async function decryptField(packed: string): Promise<string> {
  const [ivB64, tagB64, dataB64] = packed.split(':');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Malformed encrypted field: expected iv:authTag:ciphertext');
  }

  const key = await getKey();
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(dataB64, 'base64');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}
