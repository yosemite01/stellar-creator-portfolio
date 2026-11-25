import {Address} from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';

    /**
 * Typed errors returned by freelancer entrypoints (#1562).
 *
 * Codes are part of the contract's public interface: never renumber an
 * existing variant, only append. See docs/contracts.md for the full table.
 */
export const FreelancerError = {
  1 : { message: "AlreadyInitialized" },
  2 : { message: "NotInitialized" },
  3 : { message: "NotRegistered" },
  4 : { message: "InvalidRating" },
  5 : { message: "IdentityNotFound" },
  6 : { message: "Unauthorized" },
  /**
   * Escrow / review source contract not configured (#1726).
   */
  7 : { message: "SourceNotConfigured" },
  /**
   * The escrow was not released to this freelancer (#1726).
   */
  8 : { message: "EscrowNotReleased" },
  /**
   * The escrow release has already been credited (#1726).
   */
  9 : { message: "AlreadyCredited" },
  /**
   * Stats for this profile were already migrated (#1726).
   */
  10 : { message: "AlreadyMigrated" }
}

/**
 * Identity Registry Metadata
 */
export interface IdentityMetadata {
  address: string;
  last_updated: bigint;
  metadata: Map<string, string>;
}

/**
 * Freelancer Profile
 */
export interface FreelancerProfile {
  address: string;
  bio: string;
  completed_projects: number;
  created_at: bigint;
  discipline: string;
  name: string;
  rating: number;
  total_earnings: bigint;
  total_rating_count: number;
  verified: boolean;
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
    
    
export type FreelancerError = (typeof FreelancerError)[keyof typeof FreelancerError];

export type UpgradeError = (typeof UpgradeError)[keyof typeof UpgradeError];
