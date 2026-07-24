/**
 * Slippage-tolerance math for yield-vault deposits.
 * Spec: IMPLEMENTATION_NOTES.md#yield-deposit-slippage-tolerance
 */

const BPS_DENOMINATOR = 10_000

export interface SlippageInput {
  /** Shares quoted for the deposit at request time. */
  expectedShares: number
  /** User-configured tolerance, in basis points (e.g. 50 = 0.50%). */
  maxSlippageBps: number
}

/**
 * recommended min_shares = expected_shares * (1 - max_slippage_bps / 10_000)
 */
export function calculateMinShares({ expectedShares, maxSlippageBps }: SlippageInput): number {
  if (expectedShares < 0) {
    throw new RangeError('expectedShares must be >= 0')
  }
  if (maxSlippageBps < 0 || maxSlippageBps > BPS_DENOMINATOR) {
    throw new RangeError('maxSlippageBps must be between 0 and 10_000')
  }

  return expectedShares * (1 - maxSlippageBps / BPS_DENOMINATOR)
}

/** Actual shares as a percentage of expected shares, e.g. for warning the user pre-confirm. */
export function actualSlippageBps(expectedShares: number, actualShares: number): number {
  if (expectedShares <= 0) return 0
  return Math.max(0, (1 - actualShares / expectedShares) * BPS_DENOMINATOR)
}
