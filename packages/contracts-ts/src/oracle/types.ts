

/**
 * Errors returned by the oracle contract.
 */
export enum OracleError {
  AmountMustBePositive = 1,
  PriceUnavailable = 2,
  InvalidDecimals = 3,
  Overflow = 4,
  DivisionByZero = 5,
}

/**
 * Rounding direction for token valuation.
 */
export enum Rounding {
  Floor = 0,
  Ceil = 1,
}

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
 * Result of an atomic valuation at execution time.
 */
export interface ValuationResult {
  /**
   * Token decimals used for the conversion.
   */
  decimals: number;
  /**
   * Price used for the conversion (micro-USD per whole token).
   */
  price_used: bigint;
  /**
   * Rounding direction applied during valuation.
   */
  rounding: Rounding;
  /**
   * Equivalent token amount at the locked-in price, in smallest token units (e.g. stroops).
   */
  token_amount: bigint;
  /**
   * USD amount requested (micro-USD).
   */
  usd_amount_micro: bigint;
  /**
   * Whether the fallback price was used instead of the live oracle price (always false on success).
   */
  used_fallback: boolean;
}
    
    