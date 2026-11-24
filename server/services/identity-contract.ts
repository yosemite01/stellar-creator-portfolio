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
 *
 * #1811: writes are retried with idempotency — before every retry (and
 * after a failure) the attestation is read back from the chain, so a tx that
 * landed despite a client-side error is never submitted twice, and a failed
 * tx is never reported as success. DB ↔ chain drift is repaired by
 * `server/services/identity-sync.ts` (event handler + reconciliation job).
 */

import {
  Contract,
  Keypair,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
} from '@stellar/stellar-sdk';
import { stellarClient } from '@/server/stellar/client';
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
  options: ChainRetryOptions = {},
): Promise<string | null> {
  if (kycSubmissionIdHash.length !== 32) {
    throw new Error('kycSubmissionIdHash must be exactly 32 bytes');
  }
  const { commitment } = await kycOpeningForSubmission(kycSubmissionIdHash);

  const adminSecret = await getSecret('STELLAR_ADMIN_SECRET');
  const signer = new LocalSigner(adminSecret);
  const adminPublicKey = Keypair.fromSecret(adminSecret).publicKey();

  return invokeIdempotent(
    () =>
      contractService.invokeContractMethod(
        identityContractId(),
        'verify_kyc',
        [adminPublicKey, userAddress, kycSubmissionIdHash],
        signer,
      ),
    async () => (await readKycAttestation(userAddress, adminPublicKey)) !== null,
    options,
  );
}

/**
 * Calls `revoke_kyc(admin, user)` on the identity contract, signed by the
 * platform admin key. Removes the user's KYC commitment so `check_kyc`
 * returns false for every opening — a revoked user reads exactly like one who
 * was never verified. Fails on-chain if the user has no attestation.
 */
export async function revokeKycOnChain(
  userAddress: string,
  options: ChainRetryOptions = {},
): Promise<string | null> {
  const adminSecret = await getSecret('STELLAR_ADMIN_SECRET');
  const signer = new LocalSigner(adminSecret);
  const adminPublicKey = Keypair.fromSecret(adminSecret).publicKey();

  return invokeIdempotent(
    () =>
      contractService.invokeContractMethod(
        identityContractId(),
        'revoke_kyc',
        [adminPublicKey, userAddress],
        signer,
      ),
    async () => (await readKycAttestation(userAddress, adminPublicKey)) === null,
    options,
  );
}

// ── #1811: chain reads, retry with idempotency ──────────────────────────────

export interface KycAttestation {
  level: number;
  attestedAt: number;
  expiresAt: number;
}

export interface ChainRetryOptions {
  /** Total attempts including the first. Default 3. */
  maxAttempts?: number;
  /** Base backoff in ms, doubled per attempt. Default 1000. */
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs `submit` until it succeeds, retrying with exponential backoff.
 * `alreadyApplied` reads the chain: it is checked before every attempt
 * after the first and once more after the final failure, so a transaction
 * that landed despite a client-side error is never sent twice.
 *
 * Returns the tx hash, or `null` when the chain already reflects the desired
 * state and nothing was submitted. Throws when every attempt failed and the
 * chain still does not reflect it — callers must not mark anything verified.
 */
export async function invokeIdempotent(
  submit: () => Promise<string>,
  alreadyApplied: () => Promise<boolean>,
  { maxAttempts = 3, baseDelayMs = 1000, sleep = defaultSleep }: ChainRetryOptions = {},
): Promise<string | null> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      await sleep(baseDelayMs * 2 ** (attempt - 1));
      if (await safeCheck(alreadyApplied)) return null;
    }
    try {
      return await submit();
    } catch (error) {
      lastError = error;
    }
  }
  if (await safeCheck(alreadyApplied)) return null;
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function safeCheck(check: () => Promise<boolean>): Promise<boolean> {
  try {
    return await check();
  } catch {
    // An unreadable chain is not evidence the write landed.
    return false;
  }
}

/**
 * Reads `get_kyc_attestation(user)` via simulation (no fee, no signature).
 * Returns null when the user has no attestation or it has expired, matching
 * what `check_kyc` would report.
 */
export async function readKycAttestation(
  userAddress: string,
  sourcePublicKey?: string,
): Promise<KycAttestation | null> {
  const server = stellarClient.rpc;
  const source =
    sourcePublicKey ??
    Keypair.fromSecret(await getSecret('STELLAR_ADMIN_SECRET')).publicKey();
  const account = await server.getAccount(source);
  const tx = new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase: stellarClient.config.networkPassphrase,
  })
    .addOperation(
      new Contract(identityContractId()).call(
        'get_kyc_attestation',
        nativeToScVal(userAddress, { type: 'address' }),
      ),
    )
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`get_kyc_attestation simulation failed: ${JSON.stringify(sim.error)}`);
  }
  const retval = sim.result?.retval;
  const native = retval ? (scValToNative(retval) as Record<string, unknown> | null) : null;
  return parseKycAttestation(native, Math.floor(Date.now() / 1000));
}

/** Converts the decoded contract struct; expired attestations read as null. */
export function parseKycAttestation(
  native: Record<string, unknown> | null | undefined,
  nowSecs: number,
): KycAttestation | null {
  if (!native) return null;
  const attestation: KycAttestation = {
    level: Number(native.level ?? 0),
    attestedAt: Number(native.attested_at ?? 0),
    expiresAt: Number(native.expires_at ?? 0),
  };
  return attestation.expiresAt >= nowSecs ? attestation : null;
}
