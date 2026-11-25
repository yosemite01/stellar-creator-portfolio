import {Address} from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';

    /**
 * Reflector (SEP-40) asset identifier.
 */
 export type Asset =
  { tag: "Stellar"; values: readonly [string] } |
  { tag: "Other"; values: readonly [string] };

/**
 * A single price observation from the oracle network.
 */
export interface PriceData {
  /**
   * Asset price in micro-USD (6 decimal places, e.g. 1 USD = 1_000_000).
   */
  price_micro_usd: bigint;
  /**
   * Number of oracle sources that agreed on this price.
   */
  sources: number;
  /**
   * Ledger timestamp when this price was recorded.
   */
  timestamp: bigint;
}

/**
 * Price for display purposes, returned even when stale (`get_price_unchecked`).
 */
export interface PriceView {
  /**
   * `true` when the price is older than `MAX_PRICE_AGE_SECS` and would be
   * rejected by `get_price`.
   */
  is_stale: boolean;
  price: PriceData;
}

/**
 * Typed errors returned by the price read paths.
 *
 * Codes are part of the public interface — append only, never renumber.
 */
export const OracleError = {
  /**
   * Price data exists but none of it is younger than `MAX_PRICE_AGE_SECS`
   * (or the reporter quorum is not met with fresh reports).
   */
  1 : { message: "Stale" },
  /**
   * No price has ever been recorded from any source.
   */
  2 : { message: "NoPrice" }
}

/**
 * Secondary-source configuration.
 */
export interface ReflectorConfig {
  asset: Asset;
  contract: string;
}

/**
 * Result of an atomic valuation at execution time.
 */
export interface ValuationResult {
  /**
   * Price used for the conversion (micro-USD per token).
   */
  price_used: bigint;
  /**
   * Equivalent token amount at the locked-in price.
   */
  token_amount: bigint;
  /**
   * USD amount requested (micro-USD).
   */
  usd_amount_micro: bigint;
  /**
   * Whether the secondary (Reflector) source supplied the price instead of
   * the primary reporters / registered oracle. Never a hardcoded rate.
   */
  used_fallback: boolean;
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
    
    
export type OracleError = (typeof OracleError)[keyof typeof OracleError];

export type UpgradeError = (typeof UpgradeError)[keyof typeof UpgradeError];
