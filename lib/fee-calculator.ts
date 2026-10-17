/**
 * Fee calculation logic — Issue #344
 *
 * Platform fee: 2.5% of the escrow amount, capped at 500 USDC.
 * Network fee: fixed 0.00001 XLM per Stellar operation (standard base fee).
 *
 * These values mirror the constants in the Soroban escrow contract so the
 * frontend can show accurate fee previews before the user signs a transaction.
 */

/** Platform fee rate (2.5 %). */
export const PLATFORM_FEE_BPS = 250; // basis points

/** Hard ceiling for governance-settable platform fees: 10% (1000 bps), aligned with contract MAX_FEE_BPS. */
export const MAX_FEE_BPS = 1000;

/** Maximum platform fee in the token's smallest unit (e.g. stroops for XLM). */
export const PLATFORM_FEE_CAP = 500;

/** Stellar base network fee per operation in XLM. */
export const NETWORK_FEE_XLM = 0.00001;

/**
 * Validates fee basis points against contract MAX_FEE_BPS limit (Issue #1576).
 * Mirrors assert_valid_fee_bps in core/src/fee.rs.
 */
export function assertValidFeeBps(feeBps: number): void {
  if (feeBps > MAX_FEE_BPS) {
    throw new Error('Fee exceeds maximum of 1000 basis points (10%)');
  }
}

/**
 * Computes fee in integer units (stroops), exactly matching contract core/src/fee.rs:
 * `amount * (fee_bps as i128) / 10_000`
 */
export function computeFee(amount: bigint | number | string, feeBps: number = PLATFORM_FEE_BPS): bigint {
  assertValidFeeBps(feeBps);
  const bigAmount = BigInt(amount);
  if (bigAmount <= 0n) return 0n;
  return (bigAmount * BigInt(feeBps)) / 10000n;
}

/**
 * Computes net amount after platform fee in integer units (stroops), matching core/src/fee.rs.
 */
export function computeNet(amount: bigint | number | string, feeBps: number = PLATFORM_FEE_BPS): bigint {
  const bigAmount = BigInt(amount);
  return bigAmount - computeFee(bigAmount, feeBps);
}


export interface FeeBreakdown {
  /** Gross amount the payer deposits into escrow. */
  grossAmount: number;
  /** Platform fee deducted from the gross amount. */
  platformFee: number;
  /** Net amount the payee receives after the platform fee. */
  netAmount: number;
  /** Stellar network fee paid separately in XLM. */
  networkFeeXlm: number;
  /** Effective fee rate as a percentage string, e.g. "2.50%". */
  effectiveRate: string;
}

/**
 * Calculate the full fee breakdown for an escrow deposit.
 *
 * @param grossAmount - The total amount being deposited (in token units, e.g. USDC).
 * @param operationCount - Number of Stellar operations in the transaction (default 1).
 */
export function calculateFees(grossAmount: number, operationCount = 1): FeeBreakdown {
  if (grossAmount <= 0) {
    return {
      grossAmount: 0,
      platformFee: 0,
      netAmount: 0,
      networkFeeXlm: NETWORK_FEE_XLM * operationCount,
      effectiveRate: '0.00%',
    };
  }

  const rawFee = (grossAmount * PLATFORM_FEE_BPS) / 10_000;
  const platformFee = Math.min(rawFee, PLATFORM_FEE_CAP);
  const netAmount = grossAmount - platformFee;
  const networkFeeXlm = NETWORK_FEE_XLM * operationCount;
  const effectiveRate = ((platformFee / grossAmount) * 100).toFixed(2) + '%';

  return { grossAmount, platformFee, netAmount, networkFeeXlm, effectiveRate };
}

/**
 * Format a FeeBreakdown into a human-readable summary string.
 * Useful for tooltips and confirmation dialogs.
 */
export function formatFeeBreakdown(breakdown: FeeBreakdown, currency = 'USDC'): string {
  return (
    `Gross: ${breakdown.grossAmount} ${currency} | ` +
    `Platform fee (${breakdown.effectiveRate}): ${breakdown.platformFee.toFixed(2)} ${currency} | ` +
    `Net to payee: ${breakdown.netAmount.toFixed(2)} ${currency} | ` +
    `Network fee: ${breakdown.networkFeeXlm} XLM`
  );
}
