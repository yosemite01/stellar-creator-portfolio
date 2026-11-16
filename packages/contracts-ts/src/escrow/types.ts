import {Address} from '@stellar/stellar-sdk';

    /**
 * DataKey for typed persistent storage lookups.
 */
 export type DataKey =
  { tag: "Escrow"; values: readonly [bigint] } |
  { tag: "EscrowCounter"; values: void } |
  { tag: "Yield"; values: readonly [bigint] } |
  { tag: "YieldCfg"; values: void } |
  { tag: "YieldPaused"; values: void } |
  { tag: "MilestoneCount"; values: readonly [bigint] } |
  { tag: "MilestoneTotal"; values: readonly [bigint] } |
  { tag: "MilestoneReleasedCount"; values: readonly [bigint] } |
  { tag: "MilestoneReleasedAmount"; values: readonly [bigint] } |
  { tag: "DisputeExpiry"; values: readonly [bigint] } |
  { tag: "DisputeSplit"; values: void } |
  { tag: "FeeConfig"; values: void } |
  { tag: "OracleStalenessSecs"; values: void } |
  { tag: "OracleAddress"; values: void } |
  { tag: "DisputeSplitSnapshot"; values: readonly [bigint] };

/**
 * Governance-configurable fee configuration stored on-chain (#722).
 */
export interface FeeConfig {
  fee_bps: bigint;
  fee_cap: bigint;
}

/**
 * Milestone â€” a named portion of the total escrow amount
 */
export interface Milestone {
  amount: bigint;
  description: string;
  escrow_id: bigint;
  index: number;
  released: boolean;
}

/**
 * Platform-level yield configuration set by the admin.
 *
 * `rate_bps`           — annual yield rate in basis points (e.g. 300 = 3 %)
 * `max_yield_ratio`    — maximum yield as a fraction of principal in bps
 * (e.g. 500 = 5 % cap; protects against runaway accrual)
 * `min_liquidity_bps`  — minimum principal that must remain liquid, in bps of
 * total locked (e.g. 9000 = 90 % must stay withdrawable)
 * `max_slippage_bps`   — maximum acceptable slippage for yield-protocol
 * deposits, in bps (e.g. 100 = 1 %); governance-
 * configurable via `configure_slippage`
 */
export interface YieldConfig {
  max_slippage_bps: number;
  max_yield_ratio: number;
  min_liquidity_bps: number;
  rate_bps: number;
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
  Complete = 4,
  /**
   * Enum Case: SettledByTimeout
   */
  SettledByTimeout = 5,
}

/**
 * Per-escrow yield accrual tracking.  Yield is held internally in the
 * contract and never credited to either party's off-chain ledger.
 */
export interface YieldAccrual {
  accrued: bigint;
  escrow_id: bigint;
  last_updated: bigint;
  principal: bigint;
}

/**
 * Escrow Account
 */
export interface EscrowAccount {
  amount: bigint;
  bounty_id: bigint;
  created_at: bigint;
  dispute_fee_bps: bigint | null;
  dispute_fee_cap: bigint | null;
  dispute_split_bps: number | null;
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
 * Mirrors `oracle::PriceData` field-for-field so the cross-contract call in
 * `release_funds` can decode the oracle's return value without a crate
 * dependency on the oracle contract itself.
 */
export interface OraclePriceData {
  price_micro_usd: bigint;
  sources: number;
  timestamp: bigint;
}

/**
 * Release Condition
 */
 export type ReleaseCondition =
  { tag: "OnCompletion"; values: void } |
  { tag: "Timelock"; values: readonly [bigint] };
    
    