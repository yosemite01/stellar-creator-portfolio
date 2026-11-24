/**
 * #1811: keeps `KYCSubmission.verifiedOnChain` consistent with the identity
 * contract's attestations.
 *
 * - Event-driven sync: `applyIdentityEvent` handles the indexer's
 *   `(kyc, verified)` / `(kyc, revoked)` events and updates the row of the
 *   user that owns the wallet.
 * - Reconciliation job: `reconcileKycSubmissions` walks submissions, reads
 *   the chain and repairs drift in either direction — submitting the missing
 *   verify/revoke (idempotently, with retries) or correcting the DB flag.
 *
 * The chain is the source of truth for `verifiedOnChain`; the DB is the
 * source of truth for the review decision (`status`). A submission is only
 * marked verified after the chain read confirms the attestation, so a failed
 * tx never marks anyone verified.
 */

import { createHash } from 'crypto';

export interface KycRow {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  verifiedOnChain: boolean;
  walletAddress: string | null;
}

export interface IdentitySyncDeps {
  listSubmissions(cursor: string | undefined, take: number): Promise<KycRow[]>;
  findByWallet(walletAddress: string): Promise<KycRow | null>;
  markOnChain(id: string, verifiedOnChain: boolean, txHash?: string | null): Promise<void>;
  isAttested(walletAddress: string): Promise<boolean>;
  verify(walletAddress: string, submissionIdHash: Uint8Array): Promise<string | null>;
  revoke(walletAddress: string): Promise<string | null>;
  log?(message: string, meta?: Record<string, unknown>): void;
}

export type ReconcileAction =
  | 'in-sync'
  | 'verified-on-chain'
  | 'revoked-on-chain'
  | 'db-marked-verified'
  | 'db-marked-unverified'
  | 'skipped-no-wallet'
  | 'failed';

export function submissionIdHash(id: string): Uint8Array {
  return createHash('sha256').update(id).digest();
}

/** Reconcile one submission against the chain. Never throws. */
export async function reconcileSubmission(row: KycRow, deps: IdentitySyncDeps): Promise<ReconcileAction> {
  if (!row.walletAddress) {
    if (row.verifiedOnChain) {
      await deps.markOnChain(row.id, false);
      return 'db-marked-unverified';
    }
    return 'skipped-no-wallet';
  }

  try {
    const attested = await deps.isAttested(row.walletAddress);
    const shouldBeAttested = row.status === 'APPROVED';

    if (shouldBeAttested && !attested) {
      const txHash = await deps.verify(row.walletAddress, submissionIdHash(row.id));
      // Confirm on-chain before flipping the flag.
      if (!(await deps.isAttested(row.walletAddress))) {
        if (row.verifiedOnChain) await deps.markOnChain(row.id, false);
        return 'failed';
      }
      await deps.markOnChain(row.id, true, txHash);
      return 'verified-on-chain';
    }

    if (!shouldBeAttested && attested) {
      await deps.revoke(row.walletAddress);
      if (row.verifiedOnChain) await deps.markOnChain(row.id, false);
      return 'revoked-on-chain';
    }

    if (attested !== row.verifiedOnChain) {
      await deps.markOnChain(row.id, attested);
      return attested ? 'db-marked-verified' : 'db-marked-unverified';
    }
    return 'in-sync';
  } catch (error) {
    deps.log?.('KYC reconcile failed', { submissionId: row.id, error: String(error) });
    // A failed write must leave (or put) the row unverified unless the
    // chain says otherwise.
    try {
      const attested = await deps.isAttested(row.walletAddress);
      if (attested !== row.verifiedOnChain) await deps.markOnChain(row.id, attested);
    } catch {
      // chain unreadable: leave the row for the next run
    }
    return 'failed';
  }
}

/** Reconciliation job: walks every submission in pages. */
export async function reconcileKycSubmissions(
  deps: IdentitySyncDeps,
  pageSize = 100,
): Promise<Record<ReconcileAction, number>> {
  const counts: Record<ReconcileAction, number> = {
    'in-sync': 0,
    'verified-on-chain': 0,
    'revoked-on-chain': 0,
    'db-marked-verified': 0,
    'db-marked-unverified': 0,
    'skipped-no-wallet': 0,
    failed: 0,
  };
  let cursor: string | undefined;
  for (;;) {
    const page = await deps.listSubmissions(cursor, pageSize);
    for (const row of page) counts[await reconcileSubmission(row, deps)]++;
    if (page.length < pageSize) break;
    cursor = page[page.length - 1].id;
  }
  return counts;
}

export interface IdentityContractEvent {
  /** `verified` | `revoked` (second topic of the `kyc` event). */
  action: string;
  walletAddress: string;
}

/**
 * Event-driven sync. Idempotent: replaying an event leaves the row as is.
 * The flag follows the event; the review decision (`status`) is untouched,
 * so an unexpected event (e.g. verified while REJECTED) is fixed up by the
 * next reconciliation run rather than silently trusted.
 */
export async function applyIdentityEvent(
  event: IdentityContractEvent,
  deps: Pick<IdentitySyncDeps, 'findByWallet' | 'markOnChain' | 'log'>,
): Promise<boolean> {
  if (event.action !== 'verified' && event.action !== 'revoked') return false;
  const row = await deps.findByWallet(event.walletAddress);
  if (!row) {
    deps.log?.('KYC event for unknown wallet', { walletAddress: event.walletAddress, action: event.action });
    return false;
  }
  const verified = event.action === 'verified';
  if (row.verifiedOnChain === verified) return false;
  await deps.markOnChain(row.id, verified);
  return true;
}
