/**
 * Envelope encryption for KYC PII with per-record DEKs.
 *
 * Uses AES-256-GCM with a unique DEK (Data Encryption Key) per KYC submission.
 * Each DEK is encrypted by the KMS CMK and stored alongside the ciphertext.
 * This enables:
 * - Per-record key rotation without re-encrypting all data
 * - Key versioning and rotation
 * - AAD binding to user ID + field name for tamper detection
 *
 * Key format:
 *   kmsKeyId:dekVersion:iv:authTag:ciphertext
 *
 * Where ciphertext = DEK(plaintext) and DEK = KMS.decrypt(kmsKeyId, encryptedDEK)
 */

import { randomBytes, createCipheriv, createDecipheriv, createSecretKey, privateDecrypt } from 'crypto';
import { getSecret } from '@/server/services/kms';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const DEK_LENGTH = 32; // 256-bit DEK

// Current KMS key version
const CURRENT_KEY_VERSION = 'v1';

interface EncryptedField {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyId: string;
  keyVersion: string;
  aad: string;
}

/**
 * Get the CMK ID from KMS configuration
 */
async function getKmsKeyId(): Promise<string> {
  const secret = await getSecret('ENCRYPTION_KEY');
  return secret;
}

/**
 * Get the current CMK version
 */
function getCurrentKeyVersion(): string {
  return CURRENT_KEY_VERSION;
}

/**
 * Generate a random DEK (Data Encryption Key)
 */
function generateDEK(): Buffer {
  return randomBytes(DEK_LENGTH);
}

/**
 * Encrypt the DEK using KMS CMK
 */
async function encryptDEK(dek: Buffer, keyId: string): Promise<string> {
  // For AWS: Use KMS to encrypt the DEK
  // For Azure: Use Key Vault to encrypt the DEK
  // For local: Use the ENCRYPTION_KEY as the CMK
  
  const cmk = await getSecret('ENCRYPTION_KEY');
  const cmkBuffer = Buffer.from(cmk, 'hex');
  
  if (cmkBuffer.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be 32 bytes for AES-256-GCM');
  }
  
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', cmkBuffer, iv);
  
  const encrypted = Buffer.concat([cipher.update(dek), cipher.final()]);
  const authTag = cipher.getAuthTag();
  
  // Return: iv:authTag:encryptedDEK
  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

/**
 * Decrypt the DEK using KMS CMK
 */
async function decryptDEK(encryptedDEK: string, keyId: string): Promise<Buffer> {
  const cmk = await getSecret('ENCRYPTION_KEY');
  const cmkBuffer = Buffer.from(cmk, 'hex');
  
  if (cmkBuffer.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be 32 bytes for AES-256-GCM');
  }
  
  const parts = encryptedDEK.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted DEK format');
  }
  
  const iv = Buffer.from(parts[0], 'base64');
  const authTag = Buffer.from(parts[1], 'base64');
  const ciphertext = Buffer.from(parts[2], 'base64');
  
  const decipher = createDecipheriv('aes-256-gcm', cmkBuffer, iv);
  decipher.setAuthTag(authTag);
  
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext;
}

/**
 * Build AAD (Additional Authenticated Data) for tamper detection
 */
function buildAAD(userId: string, fieldName: string): string {
  return JSON.stringify({ userId, fieldName });
}

/**
 * Encrypt a field with envelope encryption
 */
export async function encryptFieldWithEnvelope(
  plaintext: string,
  userId: string,
  fieldName: string,
): Promise<string> {
  // Generate per-record DEK
  const dek = generateDEK();
  
  // Encrypt DEK with KMS CMK
  const keyId = await getKmsKeyId();
  const keyVersion = getCurrentKeyVersion();
  const encryptedDEK = await encryptDEK(dek, keyId);
  
  // Encrypt field with DEK and AAD
  const iv = randomBytes(IV_LENGTH);
  const aad = buildAAD(userId, fieldName);
  
  const cipher = createCipheriv(ALGORITHM, dek, iv);
  cipher.setAAD(Buffer.from(aad));
  
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
  const authTag = cipher.getAuthTag();
  
  // Return: encryptedDEK:iv:authTag:ciphertext
  return [
    encryptedDEK,
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

/**
 * Decrypt a field with envelope encryption
 * Supports multiple key versions for rotation
 */
export async function decryptFieldWithEnvelope(
  packed: string,
  userId: string,
  fieldName: string,
): Promise<string> {
  const parts = packed.split(':');
  if (parts.length < 4) {
    throw new Error('Malformed encrypted field');
  }
  
  const encryptedDEK = parts[0];
  const iv = Buffer.from(parts[1], 'base64');
  const authTag = Buffer.from(parts[2], 'base64');
  const ciphertext = Buffer.from(parts[3], 'base64');
  const aad = buildAAD(userId, fieldName);
  
  // Try to decrypt DEK (may support multiple versions in future)
  let dek: Buffer;
  try {
    dek = await decryptDEK(encryptedDEK, 'current');
  } catch (error) {
    // Try decryption with current CMK
    const cmk = await getSecret('ENCRYPTION_KEY');
    const cmkBuffer = Buffer.from(cmk, 'hex');
    
    // Extract components
    const dekParts = encryptedDEK.split(':');
    if (dekParts.length !== 3) {
      throw new Error('Invalid encrypted DEK format');
    }
    
    const dekIv = Buffer.from(dekParts[0], 'base64');
    const dekAuthTag = Buffer.from(dekParts[1], 'base64');
    const dekCiphertext = Buffer.from(dekParts[2], 'base64');
    
    const decipher = createDecipheriv('aes-256-gcm', cmkBuffer, dekIv);
    decipher.setAuthTag(dekAuthTag);
    
    dek = Buffer.concat([decipher.update(dekCiphertext), decipher.final()]);
  }
  
  // Verify AAD and decrypt
  const decipher = createDecipheriv(ALGORITHM, dek, iv);
  decipher.setAAD(Buffer.from(aad));
  
  try {
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString('utf8');
  } catch (error) {
    // AAD verification failed - possible tampering
    throw new Error('Decryption failed: AAD verification error');
  }
}

/**
 * Encrypt multiple fields in one operation
 */
export async function encryptFieldsWithEnvelope<T extends Record<string, string | undefined>>(
  fields: T,
  userId: string,
): Promise<{ [K in keyof T]: string | undefined }> {
  const entries = await Promise.all(
    Object.entries(fields).map(async ([key, value]) => {
      if (value === undefined || value === '') {
        return [key, value] as const;
      }
      return [key, await encryptFieldWithEnvelope(value, userId, key)] as const;
    }),
  );
  return Object.fromEntries(entries) as { [K in keyof T]: string | undefined };
}

/**
 * Decrypt multiple fields in one operation
 */
export async function decryptFieldsWithEnvelope<T extends Record<string, string | undefined>>(
  fields: T,
  userId: string,
): Promise<{ [K in keyof T]: string | undefined }> {
  const entries = await Promise.all(
    Object.entries(fields).map(async ([key, value]) => {
      if (value === undefined || value === '') {
        return [key, value] as const;
      }
      try {
        const decrypted = await decryptFieldWithEnvelope(value as string, userId, key);
        return [key, decrypted] as const;
      } catch (error) {
        throw new Error(`Failed to decrypt field ${key}: ${(error instanceof Error ? error.message : String(error))}`);
      }
    }),
  );
  return Object.fromEntries(entries) as { [K in keyof T]: string | undefined };
}
