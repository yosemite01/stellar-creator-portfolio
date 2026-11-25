import {Address} from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';

    /**
 * Proposal
 */
export interface Proposal {
  created_at: bigint;
  description: string;
  id: bigint;
  no_votes: bigint;
  proposer: string;
  status: string;
  title: string;
  voting_deadline: bigint;
  yes_votes: bigint;
}

/**
 * Weighted vote cast by a token holder.
 *
 * `weight` is the voter's checkpointed voting power at the proposal's
 * snapshot ledger (Issue #1565), in the voting token's smallest
 * denomination. It is read on-chain, never supplied by the caller.
 */
export interface TokenVote {
  proposal_id: bigint;
  vote_yes: boolean;
  voter: string;
  weight: bigint;
}

/**
 * Optional on-chain parameter change attached to a proposal.
 *
 * When a proposal carries a `ProposalParam`, `execute_timelocked` applies
 * the change directly to the governance config, creating a fully on-chain
 * parameter-update flow without requiring a separate admin transaction.
 */
export interface ProposalParam {
  /**
   * New platform fee in basis points (None = no change).
   */
  target_fee_bps: number | null;
  /**
   * New maximum bounty budget (None = no change).
   */
  target_max_budget: bigint | null;
  /**
   * New minimum bounty budget (None = no change).
   */
  target_min_budget: bigint | null;
}

/**
 * Governance Configuration
 */
export interface GovernanceConfig {
  admin_address: string;
  dispute_resolution_period: bigint;
  last_updated: bigint;
  max_bounty_budget: bigint;
  min_bounty_budget: bigint;
  platform_fee_percent: number;
}

/**
 * Execution timelock for an approved proposal.
 *
 * An approved proposal must wait `unlock_at` (ledger timestamp) before
 * `execute_timelocked` can be called.  This guards against flash-loan
 * or rushed governance attacks.
 */
export interface ExecutionTimelock {
  proposal_id: bigint;
  unlock_at: bigint;
}

/**
 * Errors raised by the shared upgrade/admin helpers.
 *
 * Codes start at 900 so they don't overlap any contract's own error enum;
 * they surface on-chain as `Error(Contract, #9xx)`.
 */
export const UpgradeError = {
  /**
   * Caller is not the stored admin.
   */
  900 : { message: "Unauthorized" },
  /**
   * `execute_upgrade` / `cancel_upgrade` called with nothing pending.
   */
  901 : { message: "NoPendingUpgrade" },
  /**
   * `execute_upgrade` called before `executable_at`.
   */
  902 : { message: "TimelockNotElapsed" },
  /**
   * `accept_admin` / `cancel_admin_transfer` called with nothing pending.
   */
  903 : { message: "NoPendingAdmin" },
  /**
   * `accept_admin` signed by an address other than the nominee.
   */
  904 : { message: "NotPendingAdmin" },
  /**
   * `propose_admin` nominated the current admin.
   */
  905 : { message: "SameAdmin" }
}

/**
 * A proposed code upgrade waiting out its timelock.
 */
export interface PendingUpgrade {
  executable_at: bigint;
  proposed_at: bigint;
  wasm_hash: Buffer;
}
    
    
export type UpgradeError = (typeof UpgradeError)[keyof typeof UpgradeError];
