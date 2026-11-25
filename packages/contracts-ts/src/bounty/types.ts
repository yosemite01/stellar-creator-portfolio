import {Address} from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';

    /**
 * Bounty Struct
 */
export interface Bounty {
  budget: bigint;
  completed_at: bigint | null;
  created_at: bigint;
  creator: string;
  deadline: bigint;
  description: string;
  escrow_id: bigint;
  id: bigint;
  selected_freelancer: string | null;
  status: BountyStatus;
  title: string;
}

/**
 * Bounty Error Codes
 *
 * Codes are part of the contract's public interface: clients and the
 * indexer map them to messages, so never renumber an existing variant —
 * only append new ones. See docs/contracts.md for the full table.
 */
export const BountyError = {
  1 : { message: "DeadlineNotPassed" },
  2 : { message: "AlreadyProcessed" },
  3 : { message: "InsufficientBalance" },
  /**
   * Bounty budget exceeds the multi-sig threshold and no signer set is configured.
   */
  4 : { message: "MultisigNotConfigured" },
  /**
   * Fewer signers authorised than the required minimum (M-of-N not satisfied).
   */
  5 : { message: "InsufficientSigners" },
  /**
   * Constructor found an admin already stored (cannot happen on a fresh deploy).
   */
  6 : { message: "AlreadyInitialized" },
  /**
   * An admin-gated method found no stored admin (legacy deploy not yet migrated).
   */
  7 : { message: "AdminNotSet" },
  /**
   * Caller is not the stored contract admin.
   */
  8 : { message: "Unauthorized" },
  /**
   * `create_and_fund_bounty` called before `set_escrow_contract`.
   */
  9 : { message: "EscrowContractNotSet" },
  10 : { message: "BountyNotFound" },
  11 : { message: "ApplicationNotFound" },
  /**
   * The application belongs to a different bounty.
   */
  12 : { message: "ApplicationMismatch" },
  /**
   * The bounty is not in the status this transition requires.
   */
  13 : { message: "InvalidStatus" },
  /**
   * Only the selected freelancer may submit completion.
   */
  14 : { message: "NotSelectedFreelancer" },
  /**
   * `required` is 0 or exceeds the signer count, or threshold <= 0.
   */
  15 : { message: "InvalidMultisigConfig" },
  /**
   * An approver is not in the configured multi-sig signer set.
   */
  16 : { message: "ApproverNotSigner" },
  /**
   * The same approver appears more than once.
   */
  17 : { message: "DuplicateApprover" },
  /**
   * #1714: the bounty already has an escrow linked.
   */
  18 : { message: "EscrowAlreadyLinked" },
  /**
   * #1714: `check_and_expire_bounty` was given an escrow contract other
   * than the one registered via `set_escrow_contract`.
   */
  19 : { message: "EscrowContractMismatch" }
}

/**
 * Bounty Status Enum
 */
export enum BountyStatus {
  /**
   * Enum Case: Open
   */
  Open = 0,
  /**
   * Enum Case: InProgress
   */
  InProgress = 1,
  /**
   * Enum Case: Completed
   */
  Completed = 2,
  /**
   * Enum Case: Disputed
   */
  Disputed = 3,
  /**
   * Enum Case: Cancelled
   */
  Cancelled = 4,
  /**
   * Enum Case: PendingCompletion
   */
  PendingCompletion = 5
}

/**
 * Bounty Application Struct
 */
export interface BountyApplication {
  bounty_id: bigint;
  created_at: bigint;
  freelancer: string;
  id: bigint;
  proposal: string;
  proposed_budget: bigint;
  status: string;
  timeline: bigint;
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
    
    
export type BountyError = (typeof BountyError)[keyof typeof BountyError];

export type UpgradeError = (typeof UpgradeError)[keyof typeof UpgradeError];
