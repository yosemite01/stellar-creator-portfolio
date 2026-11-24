
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
 * Rounding direction for `value_in_tokens`.
 *
 * - `Up`   – round in favour of the **protocol** (fees, minimum deposits).
 * - `Down` – round in favour of the **user** (payouts, withdrawals).
 */
export type RoundingMode = { tag: 'Up'; values: void } | { tag: 'Down'; values: void };

/**
 * Result of an atomic valuation at execution time.
 */
export interface ValuationResult {
  /**
   * Price used for the conversion (micro-USD per whole token).
   */
  price_used: bigint;
  /**
   * Equivalent token amount expressed in the token's smallest unit
   * (`10^token_decimals` per whole token, e.g. stroops for XLM/USDC).
   */
  token_amount: bigint;
  /**
   * Decimal places of the token (e.g. 7 for XLM, 6 for USDC).
   */
  token_decimals: number;
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
    
