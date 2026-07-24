/**
 * Thin wrapper around the Soroban identity contract's `verify_kyc` call
 * (Issue #782), used by the admin KYC review flow after a submission is
 * approved. Builds/simulates/signs/submits the invocation via the shared
 * `ContractService` and returns the transaction hash for audit purposes.
 */

import { Keypair } from '@stellar/stellar-sdk';
import { contractService } from '@/services/api/stellar/contract';
import { LocalSigner } from '@/services/api/stellar/types';
import { getSecret } from '@/backend/services/kms';

function identityContractId(): string {
  const contractId = process.env.IDENTITY_CONTRACT_ID;
  if (!contractId) {
    throw new Error('IDENTITY_CONTRACT_ID is not configured');
  }
  return contractId;
}

/**
 * Calls `verify_kyc(admin, user, kyc_submission_id)` on the identity
 * contract, signed by the platform admin key. `kycSubmissionId` should be
 * the KYCSubmission row id, hashed to 32 bytes (contracts only accept fixed-
 * size byte arrays) so the on-chain event can be traced back to the
 * off-chain record without exposing the raw id on-chain.
 */
export async function verifyKycOnChain(
  userAddress: string,
  kycSubmissionIdHash: Uint8Array,
): Promise<string> {
  if (kycSubmissionIdHash.length !== 32) {
    throw new Error('kycSubmissionIdHash must be exactly 32 bytes');
  }

  const adminSecret = await getSecret('STELLAR_ADMIN_SECRET');
  const signer = new LocalSigner(adminSecret);
  const adminPublicKey = Keypair.fromSecret(adminSecret).publicKey();

  return contractService.invokeContractMethod(
    identityContractId(),
    'verify_kyc',
    [adminPublicKey, userAddress, kycSubmissionIdHash],
    signer,
  );
}
