import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { deriveKycSalt, kycCommitment, KycLevel } from '@/lib/kyc-commitment';

const key = Buffer.alloc(32, 1);
const submission = createHash('sha256').update('sub_123').digest();

describe('kyc commitments (#1718)', () => {
  it('derives a stable 32-byte salt per submission', () => {
    const a = deriveKycSalt(key, submission);
    const b = deriveKycSalt(key, submission);
    expect(a).toHaveLength(32);
    expect(a.equals(b)).toBe(true);
    const other = deriveKycSalt(key, createHash('sha256').update('sub_456').digest());
    expect(a.equals(other)).toBe(false);
  });

  it('salt depends on the secret key', () => {
    expect(deriveKycSalt(Buffer.alloc(32, 2), submission).equals(deriveKycSalt(key, submission))).toBe(false);
  });

  it('commitment is sha256(level byte || salt), matching the contract', () => {
    const salt = Buffer.alloc(32, 9);
    const expected = createHash('sha256').update(Buffer.concat([Buffer.from([1]), salt])).digest();
    expect(kycCommitment(KycLevel.Enhanced, salt).equals(expected)).toBe(true);
  });

  it('commitment hides the level: different levels give different hashes', () => {
    const salt = deriveKycSalt(key, submission);
    const basic = kycCommitment(KycLevel.Basic, salt);
    const enhanced = kycCommitment(KycLevel.Enhanced, salt);
    expect(basic.equals(enhanced)).toBe(false);
  });

  it('rejects bad inputs', () => {
    expect(() => kycCommitment(KycLevel.Basic, Buffer.alloc(31))).toThrow();
    expect(() => kycCommitment(7 as KycLevel, Buffer.alloc(32))).toThrow();
    expect(() => deriveKycSalt(Buffer.alloc(8), submission)).toThrow();
    expect(() => deriveKycSalt(key, Buffer.alloc(16))).toThrow();
  });
});
