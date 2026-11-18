/**
 * KYC commitments for the identity contract (Issue #1718).
 *
 * Contract storage and events are public, so the platform never writes a
 * user's KYC level on-chain. It writes only
 *
 *   commitment = sha256([level as u8] || salt)
 *
 * where `salt` is 32 secret bytes. The salt is not stored anywhere: it is
 * re-derived on demand as HMAC-SHA256(ENCRYPTION_KEY, domain || submissionIdHash),
 * so the platform can hand the opening `(level, salt)` to `check_kyc` at use
 * time without a new database column. Must match `kyc_commitment` in
 * backend/contracts/identity/src/lib.rs.
 */

import { createHash, createHmac } from 'crypto';

/** On-chain `KycLevel` discriminants. */
export const KycLevel = {
  Basic: 0,
  Enhanced: 1,
  Institutional: 2,
} as const;
export type KycLevel = (typeof KycLevel)[keyof typeof KycLevel];

const SALT_DOMAIN = 'stellar-identity/kyc-commitment-salt/v1';

/** Deterministic 32-byte salt for a KYC submission. `key` must be secret. */
export function deriveKycSalt(key: Buffer, submissionIdHash: Uint8Array): Buffer {
  if (key.length < 32) {
    throw new Error('KYC salt key must be at least 32 bytes');
  }
  if (submissionIdHash.length !== 32) {
    throw new Error('submissionIdHash must be exactly 32 bytes');
  }
  return createHmac('sha256', key)
    .update(SALT_DOMAIN)
    .update(submissionIdHash)
    .digest();
}

/** sha256([level] || salt) — the value stored on-chain. */
export function kycCommitment(level: KycLevel, salt: Uint8Array): Buffer {
  if (salt.length !== 32) {
    throw new Error('salt must be exactly 32 bytes');
  }
  if (!Object.values(KycLevel).includes(level)) {
    throw new Error(`invalid KYC level: ${level}`);
  }
  return createHash('sha256').update(Buffer.from([level])).update(salt).digest();
}
