/**
 * Re-attest KYC on-chain before it expires (Issue #1717).
 *
 * For every APPROVED, on-chain-verified KYCSubmission whose user has a
 * wallet, read the identity contract's attestation and call `verify_kyc`
 * again when it is missing, invalid (`check_kyc` false, e.g. after an
 * issuer key rotation) or expires within the window. Dependencies are
 * injected so the job is unit-testable without RPC or a database.
 */

import { createHash } from 'crypto';
import {
  Account,
  Address,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  rpc,
  xdr,
} from '@stellar/stellar-sdk';
import { getNetworkConfig } from '@/lib/config/network';
import { KycLevel } from '@/lib/kyc-commitment';

export interface OnChainKycAttestation {
  expiresAt: number; // unix seconds
  valid: boolean; // result of check_kyc(user, Basic, level, salt)
}

export interface KycReattestCandidate {
  id: string;
  walletAddress: string;
}

export interface KycReattestDeps {
  listCandidates: () => Promise<KycReattestCandidate[]>;
  readAttestation: (
    walletAddress: string,
    submissionIdHash: Uint8Array,
  ) => Promise<OnChainKycAttestation | null>;
  reattest: (walletAddress: string, submissionIdHash: Uint8Array) => Promise<string | null>;
  now?: () => Date;
}

export interface KycReattestResult {
  checked: number;
  reattested: number;
  failed: number;
  skipped: number;
}

export const DEFAULT_REATTEST_WINDOW_DAYS = 30;

export function reattestWindowDays(): number {
  const raw = Number(process.env.KYC_REATTEST_WINDOW_DAYS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_REATTEST_WINDOW_DAYS;
}

/** True when the on-chain attestation needs to be re-issued. */
export function needsReattest(
  attestation: OnChainKycAttestation | null,
  nowSecs: number,
  windowDays: number,
): boolean {
  if (!attestation) return true;
  if (!attestation.valid) return true;
  return attestation.expiresAt - nowSecs <= windowDays * 24 * 60 * 60;
}

export async function reattestExpiringKyc(
  deps: KycReattestDeps,
  windowDays = reattestWindowDays(),
): Promise<KycReattestResult> {
  const nowSecs = Math.floor((deps.now?.() ?? new Date()).getTime() / 1000);
  const candidates = await deps.listCandidates();
  const result: KycReattestResult = { checked: 0, reattested: 0, failed: 0, skipped: 0 };

  for (const c of candidates) {
    result.checked += 1;
    try {
      const hash = createHash('sha256').update(c.id).digest();
      const attestation = await deps.readAttestation(c.walletAddress, hash);
      if (!needsReattest(attestation, nowSecs, windowDays)) {
        result.skipped += 1;
        continue;
      }
      await deps.reattest(c.walletAddress, hash);
      result.reattested += 1;
    } catch {
      // One failure must not block the rest; the next run retries.
      result.failed += 1;
    }
  }
  return result;
}

async function simulate(contractId: string, method: string, args: xdr.ScVal[], source: string) {
  const { rpcUrl, passphrase } = getNetworkConfig();
  const server = new rpc.Server(rpcUrl);
  const tx = new TransactionBuilder(new Account(source, '0'), { fee: '100', networkPassphrase: passphrase })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim) || !sim.result?.retval) return undefined;
  return scValToNative(sim.result.retval);
}

/**
 * Reads `get_kyc_attestation` + `check_kyc(user, required_level, level, salt)`
 * via simulation. The contract only stores a salted commitment (#1718), so
 * validity can only be checked by presenting the opening re-derived from the
 * submission id hash.
 */
export async function readKycAttestationOnChain(
  walletAddress: string,
  submissionIdHash: Uint8Array,
): Promise<OnChainKycAttestation | null> {
  const contractId = process.env.IDENTITY_CONTRACT_ID;
  if (!contractId) throw new Error('IDENTITY_CONTRACT_ID is not configured');
  const user = nativeToScVal(Address.fromString(walletAddress), { type: 'address' });
  const att = (await simulate(contractId, 'get_kyc_attestation', [user], walletAddress)) as
    | { expires_at: bigint | number }
    | null
    | undefined;
  if (!att) return null;
  // Lazy import keeps the pure scheduling logic above free of KMS/Prisma deps.
  const { kycOpeningForSubmission } = await import('@/server/services/identity-contract');
  const { level, salt } = await kycOpeningForSubmission(submissionIdHash);
  // KycLevel is an integer-valued #[contracttype] enum, encoded as u32.
  const requiredLevel = nativeToScVal(KycLevel.Basic, { type: 'u32' });
  const valid =
    (await simulate(
      contractId,
      'check_kyc',
      [user, requiredLevel, nativeToScVal(level, { type: 'u32' }), nativeToScVal(salt, { type: 'bytes' })],
      walletAddress,
    )) === true;
  return { expiresAt: Number(att.expires_at), valid };
}
