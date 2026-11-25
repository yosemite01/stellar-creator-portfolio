import {Address} from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';

    /**
 * Struct: Arbiter
 */
export interface Arbiter {
  active_cases: number;
  address: string;
  reputation: number;
  stake: bigint;
}

/**
 * Struct: Evidence
 */
export interface Evidence {
  hash: Buffer;
  submitted_at: bigint;
  submitter: string;
}

/**
 * Enum: CasePhase
 */
export enum CasePhase {
  /**
   * Panel drawn; commits then reveals are open.
   */
  Voting = 0,
  /**
   * Round-0 ruling recorded; may be appealed until `appeal_deadline`.
   */
  Appealable = 1,
  /**
   * Ruling is final and has been paid out.
   */
  Final = 2
}

/**
 * Struct: DisputeCase
 */
export interface DisputeCase {
  appeal_deadline: bigint;
  appellant: string | null;
  commit_deadline: bigint;
  empty_rounds: number;
  escrow_id: bigint;
  panel: Array<string>;
  /**
   * Members of earlier panels, excluded from later draws.
   */
  past_panels: Array<string>;
  phase: CasePhase;
  reveal_deadline: bigint;
  revealed: Array<string>;
  /**
   * 0 = first panel, 1 = appeal panel.
   */
  round: number;
  ruling_bps: number | null;
  votes: Array<number>;
}

/**
 * Struct: ArbitrationConfig
 */
export interface ArbitrationConfig {
  min_stake: bigint;
  stake_token: string;
}

/**
 * Governance-configurable fee configuration stored on-chain (#722).
 */
export interface FeeConfig {
  fee_bps: bigint;
  fee_cap: bigint;
}

/**
 * Milestone — a named portion of the total escrow amount.
 *
 * `amount` is the **net** payout to the payee (escrow amounts are already net
 * of the platform fee). `fee_share` is this milestone's share of the fee that
 * was charged once, on the total, at deposit. It is allocated with
 * largest-remainder rounding as soon as the milestone plan sums to the escrow
 * amount, so `sum(amount) + sum(fee_share) == deposited` exactly (#1712).
 */
export interface Milestone {
  amount: bigint;
  description: string;
  escrow_id: bigint;
  fee_share: bigint;
  index: number;
  released: boolean;
}

/**
 * Typed errors returned by escrow entrypoints (#1562).
 *
 * Codes are part of the contract's public interface: clients and the
 * indexer map them to messages, so never renumber an existing variant —
 * only append new ones. See docs/contracts.md for the full table.
 */
export const EscrowError = {
  1 : { message: "EscrowNotFound" },
  2 : { message: "AdminNotSet" },
  3 : { message: "AdminAlreadySet" },
  4 : { message: "Unauthorized" },
  5 : { message: "EscrowNotActive" },
  6 : { message: "ReleaseConditionNotMet" },
  7 : { message: "OraclePriceStale" },
  8 : { message: "InvalidAmount" },
  9 : { message: "NoEscrowForBounty" },
  10 : { message: "EscrowNotDisputed" },
  11 : { message: "DisputeNotExpired" },
  12 : { message: "DisputeExpiryMissing" },
  13 : { message: "InvalidBps" },
  14 : { message: "MilestoneNotFound" },
  15 : { message: "MilestoneAlreadyExists" },
  16 : { message: "MilestoneAlreadyReleased" },
  17 : { message: "MilestoneExceedsEscrow" },
  18 : { message: "UnsupportedOperation" },
  19 : { message: "YieldPaused" },
  20 : { message: "YieldNotConfigured" },
  21 : { message: "YieldAccrualNotFound" },
  22 : { message: "NoYieldToWithdraw" },
  23 : { message: "InsufficientLiquidity" },
  24 : { message: "InvalidFeeConfig" },
  25 : { message: "InvalidStaleness" },
  /**
   * #1715: `deposit` with a token that is not on the admin allowlist.
   */
  26 : { message: "TokenNotAllowed" },
  /**
   * #1715: the token moved a different amount than requested
   * (fee-on-transfer, rebasing or no-op `transfer`).
   */
  27 : { message: "TokenTransferMismatch" },
  /**
   * #1714: a bounty-driven call before `set_bounty_contract`.
   */
  28 : { message: "BountyContractNotSet" },
  /**
   * #1714: caller is not the registered bounty contract.
   */
  29 : { message: "NotBountyContract" },
  /**
   * #1714: escrow is bound to a bounty; drive it through the bounty contract.
   */
  30 : { message: "ManagedByBounty" },
  /**
   * #1714: escrow or bounty is already bound.
   */
  31 : { message: "EscrowAlreadyBound" },
  /**
   * #1714: escrow belongs to another bounty or payer.
   */
  32 : { message: "BountyMismatch" },
  /**
   * The effective platform fee exceeds the caller-supplied `max_fee` (#1724).
   */
  33 : { message: "FeeExceedsMax" },
  /**
   * No fee change is scheduled (or it already took effect).
   */
  34 : { message: "NoPendingFeeUpdate" },
  /**
   * `apply_fee_update` called before `FEE_CHANGE_DELAY_SECS` elapsed.
   */
  35 : { message: "FeeTimelockActive" },
  36 : { message: "ArbitrationNotConfigured" },
  37 : { message: "ArbitrationAlreadyConfigured" },
  38 : { message: "InsufficientStake" },
  39 : { message: "ArbiterNotFound" },
  40 : { message: "ArbiterBusy" },
  41 : { message: "NotEnoughArbiters" },
  42 : { message: "CaseNotFound" },
  43 : { message: "NotOnPanel" },
  44 : { message: "WrongPhase" },
  45 : { message: "AlreadyCommitted" },
  46 : { message: "CommitmentNotFound" },
  47 : { message: "CommitmentMismatch" },
  48 : { message: "AlreadyRevealed" },
  49 : { message: "AppealNotAllowed" },
  50 : { message: "TooMuchEvidence" },
  51 : { message: "CaseAlreadyOpen" },
  52 : { message: "ArbiterPoolFull" },
  53 : { message: "TooManyIds" },
  /**
   * Milestone amounts do not sum to the escrow amount (#1712).
   */
  54 : { message: "MilestoneSumMismatch" },
  /**
   * More than `MAX_MILESTONES` milestones on one escrow.
   */
  55 : { message: "TooManyMilestones" },
  /**
   * Milestone plan cannot be amended after a milestone was released.
   */
  56 : { message: "MilestoneAmendLocked" },
  /**
   * An outflow would leave the contract holding less than its tracked
   * principal liabilities for that token (#1706).
   */
  57 : { message: "Insolvent" },
  /**
   * `withdraw_yield` is behind a feature flag that is disabled (#1706).
   */
  58 : { message: "YieldWithdrawDisabled" },
  /**
   * Arithmetic overflow while accruing yield (#1707).
   */
  59 : { message: "Overflow" }
}

/**
 * Escrow Status
 */
export enum EscrowStatus {
  /**
   * Enum Case: Active
   */
  Active = 0,
  /**
   * Enum Case: Released
   */
  Released = 1,
  /**
   * Enum Case: Refunded
   */
  Refunded = 2,
  /**
   * Enum Case: Disputed
   */
  Disputed = 3,
  /**
   * Enum Case: Complete
   */
  Complete = 4
}

/**
 * Escrow Account
 */
export interface EscrowAccount {
  amount: bigint;
  bounty_id: bigint;
  created_at: bigint;
  fee_collected: bigint;
  id: bigint;
  payee: string;
  payer: string;
  release_condition: ReleaseCondition;
  released_at: bigint | null;
  status: EscrowStatus;
  token: string;
}

/**
 * Final, on-chain record of how a dispute was settled (#1711).
 *
 * Written by `resolve_dispute` / `resolve_expired_dispute` and exposed via
 * `get_dispute_outcome` so the insurance contract can link a claim to a
 * verified loss instead of trusting claimant-supplied evidence.
 */
export interface DisputeOutcome {
  /**
   * Escrowed (net) amount that was in dispute.
   */
  amount: bigint;
  disputed_at: bigint;
  escrow_id: bigint;
  payee: string;
  payee_amount: bigint;
  payer: string;
  payer_amount: bigint;
  resolved_at: bigint;
  token: string;
}

/**
 * A scheduled fee increase waiting out `FEE_CHANGE_DELAY_SECS` (#1724).
 */
export interface PendingFeeConfig {
  config: FeeConfig;
  effective_at: bigint;
}

/**
 * Release Condition
 */
 export type ReleaseCondition =
  { tag: "OnCompletion"; values: void } |
  { tag: "Timelock"; values: readonly [bigint] };

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
    
    
export type EscrowError = (typeof EscrowError)[keyof typeof EscrowError];

export type UpgradeError = (typeof UpgradeError)[keyof typeof UpgradeError];
