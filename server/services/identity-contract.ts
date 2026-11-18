/**
 * Thin wrapper around the Soroban identity contract's `verify_kyc` call
 * (Issue #782), used by the admin KYC review flow after a submission is
 * approved, and `revoke_kyc` (Issue #1567) for withdrawing it. Builds/
 * simulates/signs/submits the invocation via the shared `ContractService`
 * and returns the transaction hash for audit purposes.
 *
 * What "verified" means on-chain — KYC levels vs. verification tiers vs.
 * social proofs, who may issue each, the one-year KYC expiry, and how
 * revocation reads back — is specified in docs/identity-verification.md.
 * Read that before deriving any trust badge from these attestations.
 */

import { Keypair } from '@stellar/stellar-sdk';
import { contractService } from '@/server/stellar/contract';
import { LocalSigner } from '@/server/stellar/types';
import { getSecret } from '@/server/services/kms';
import { deriveKycSalt, kycCommitment, KycLevel } from '@/lib/kyc-commitment';

function identityContractId(): string {
  const contractId = process.env.IDENTITY_CONTRACT_ID;
  if (!contractId) {
    throw new Error('IDENTITY_CONTRACT_ID is not configured');
  }
  return contractId;
}

/**
 * Calls `verify_kyc(admin, user, commitment, kyc_submission_id)` on the
 * identity contract, signed by the platform admin key. `kycSubmissionIdHash`
 * is the KYCSubmission row id hashed to 32 bytes, so the on-chain event can
 * be traced back to the off-chain record without exposing the raw id.
 *
 * Only a salted commitment to the KYC level goes on-chain (Issue #1718);
 * the salt is re-derivable server-side via `kycOpeningForSubmission`.
 */
/**
 * The opening `(level, salt)` for a submission's on-chain commitment. Pass
 * both to the contract's `check_kyc(user, required_level, level, salt)` at
 * use time. Never log or persist the salt.
 */
export async function kycOpeningForSubmission(
  kycSubmissionIdHash: Uint8Array,
  level: KycLevel = KycLevel.Basic,
): Promise<{ level: KycLevel; salt: Buffer; commitment: Buffer }> {
  const key = Buffer.from(await getSecret('ENCRYPTION_KEY'), 'hex');
  const salt = deriveKycSalt(key, kycSubmissionIdHash);
  return { level, salt, commitment: kycCommitment(level, salt) };
}

export async function verifyKycOnChain(
  userAddress: string,
  kycSubmissionIdHash: Uint8Array,
  level: KycLevel = KycLevel.Basic,
): Promise<string> {
  if (kycSubmissionIdHash.length !== 32) {
    throw new Error('kycSubmissionIdHash must be exactly 32 bytes');
  }
  const { commitment } = await kycOpeningForSubmission(kycSubmissionIdHash, level);

  const adminSecret = await getSecret('STELLAR_ADMIN_SECRET');
  const signer = new LocalSigner(adminSecret);
  const adminPublicKey = Keypair.fromSecret(adminSecret).publicKey();

  return contractService.invokeContractMethod(
    identityContractId(),
    'verify_kyc',
    [adminPublicKey, userAddress, commitment, kycSubmissionIdHash],
    signer,
  );
}

/**
 * Calls `revoke_kyc(admin, user)` on the identity contract, signed by the
 * platform admin key. Removes the user's KYC commitment so `check_kyc`
 * returns false for every opening — a revoked user reads exactly like one who
 * was never verified. Fails on-chain if the user has no attestation.
 */
export async function revokeKycOnChain(userAddress: string): Promise<string> {
  const adminSecret = await getSecret('STELLAR_ADMIN_SECRET');
  const signer = new LocalSigner(adminSecret);
  const adminPublicKey = Keypair.fromSecret(adminSecret).publicKey();

  return contractService.invokeContractMethod(
    identityContractId(),
    'revoke_kyc',
    [adminPublicKey, userAddress],
    signer,
  );
}
