/**
 * __tests__/fee-calculator.test.ts
 *
 * Tests for fee calculation logic.
 *
 * Shared test vectors in fixtures/fee-vectors.json are run in both TypeScript
 * and Rust to ensure identical behavior across languages.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeFee,
  computeNet,
  computePlatformFeeWithCap,
  calculateFees,
  assertValidFeeBps,
  PLATFORM_FEE_BPS,
  PLATFORM_FEE_CAP,
  MAX_FEE_BPS,
  DEFAULT_MAX_FEE_TOLERANCE_BPS,
  computeMaxFee,
  buildDepositWithMaxFeeArgs,
} from '@/lib/fee-calculator';
import { readFileSync } from 'fs';
import { join } from 'path';

const FIXTURES_DIR = join(__dirname, '..', 'fixtures');

describe('Fee Calculator', () => {
  // Load shared test vectors from Rust
  const feeVectors = JSON.parse(
    readFileSync(join(FIXTURES_DIR, 'fee-vectors.json'), 'utf8'),
  ) as Array<{ amount: number; feeBps: number; expectedFee: number }> || [];

  describe('computeFee', () => {
    it('computes fee with exact values from shared vectors', () => {
      for (const v of feeVectors) {
        const fee = computeFee(v.amount, v.feeBps);
        expect(fee).toBe(
          v.expectedFee,
          `Fee mismatch for amount ${v.amount} and bps ${v.feeBps}: got ${fee}, expected ${v.expectedFee}`,
        );
      }
    });

    it('computes zero fee for zero amount', () => {
      expect(computeFee(0, 250)).toBe(0);
      expect(computeFee(0n, 250)).toBe(0);
    });

    it('computes fee at maximum rate (10%)', () => {
      expect(computeFee(10000, 1000)).toBe(1000);
      expect(computeFee(100000n, 1000)).toBe(10000);
    });

    it('truncates fractional fees (floor division)', () => {
      // 39 * 250 / 10000 = 0.975 → floor = 0
      expect(computeFee(39, 250)).toBe(0);
      // 40 * 250 / 10000 = 1.0 → floor = 1
      expect(computeFee(40, 250)).toBe(1);
      // 79 * 250 / 10000 = 1.975 → floor = 1
      expect(computeFee(79, 250)).toBe(1);
    });

    it('works with BigInt input', () => {
      expect(computeFee(1000n, 250)).toBe(25);
      expect(computeFee(20000n, 250)).toBe(500);
    });

    it('throws error for invalid fee rate (too high)', () => {
      expect(() => computeFee(1000, 1001)).toThrow(
        'Fee must be an integer between 0 and 1000 basis points (10%)',
      );
    });

    it('throws error for negative fee rate', () => {
      expect(() => computeFee(1000, -1)).toThrow(
        'Fee must be an integer between 0 and 1000 basis points (10%)',
      );
    });

    it('throws error for non-integer fee rate', () => {
      expect(() => computeFee(1000, 250.5)).toThrow(
        'Fee must be an integer between 0 and 1000 basis points (10%)',
      );
    });
  });

  describe('computeNet', () => {
    it('computes net correctly', () => {
      expect(computeNet(1000, 250)).toBe(975);
      expect(computeNet(10000, 250)).toBe(9750);
    });

    it('works with BigInt', () => {
      expect(computeNet(1000n, 250)).toBe(975);
    });
  });

  describe('computePlatformFeeWithCap', () => {
    it('applies cap correctly', () => {
      // At 2.5%, cap of 500 kicks in at amount = 20000
      expect(computePlatformFeeWithCap(19999, 250, 500)).toBe(499);
      expect(computePlatformFeeWithCap(20000, 250, 500)).toBe(500);
      expect(computePlatformFeeWithCap(30000, 250, 500)).toBe(500);
      expect(computePlatformFeeWithCap(10000000, 250, 500)).toBe(500);
    });

    it('does not apply cap when below threshold', () => {
      expect(computePlatformFeeWithCap(1000, 250, 500)).toBe(25);
    });
  });

  describe('calculateFees', () => {
    it('calculates correct fees for standard cases', () => {
      // 2.5% of 1000 = 25
      const result1 = calculateFees(1000);
      expect(result1.platformFee).toBe(25);
      expect(result1.netAmount).toBe(975);
      expect(result1.effectiveRate).toBe('2.50%');

      // At cap
      const result2 = calculateFees(30000);
      expect(result2.platformFee).toBe(500);
      expect(result2.netAmount).toBe(29500);
      expect(result2.effectiveRate).toBe('1.67%'); // 500/30000 = 1.67%
    });

    it('respects custom fee config', () => {
      const config = { feeBps: 500, feeCap: 1000 };
      const result = calculateFees(10000, config);
      expect(result.platformFee).toBe(500); // 10000 * 500 / 10000 = 500
      expect(result.netAmount).toBe(9500);
    });

    it('returns zero for zero or negative amount', () => {
      const result = calculateFees(0);
      expect(result.grossAmount).toBe(0);
      expect(result.platformFee).toBe(0);
      expect(result.netAmount).toBe(0);
    });

    it('includes network fee in breakdown', () => {
      const result = calculateFees(1000, undefined, 3);
      expect(result.networkFeeXlm).toBe(0.00003);
    });
  });

  describe('assertValidFeeBps', () => {
    it('accepts valid values', () => {
      expect(() => assertValidFeeBps(0)).not.toThrow();
      expect(() => assertValidFeeBps(250)).not.toThrow();
      expect(() => assertValidFeeBps(1000)).not.toThrow();
    });

    it('rejects values above max', () => {
      expect(() => assertValidFeeBps(1001)).toThrow();
      expect(() => assertValidFeeBps(10001)).toThrow();
    });

    it('rejects negative values', () => {
      expect(() => assertValidFeeBps(-1)).toThrow();
    });

    it('rejects non-integer values', () => {
      expect(() => assertValidFeeBps(250.5)).toThrow();
    });
  });

  describe('computeMaxFee with tolerance', () => {
    it('computes max fee with zero tolerance', () => {
      expect(computeMaxFee(25n, 0)).toBe(25n);
      expect(computeMaxFee(100n, 0)).toBe(100n);
    });

    it('computes max fee with tolerance', () => {
      // 25 * 100 / 10000 = 0.25 → ceil = 1 → 25 + 1 = 26
      expect(computeMaxFee(25n, 100)).toBe(26n);
      // 100 * 500 / 10000 = 5 → 100 + 5 = 105
      expect(computeMaxFee(100n, 500)).toBe(105n);
    });

    it('rounds tolerance up to avoid truncation to zero', () => {
      // Small quoted fee with small tolerance
      // 5 * 100 / 10000 = 0.05 → ceil = 1 → 5 + 1 = 6
      expect(computeMaxFee(5n, 100)).toBe(6n);
    });

    it('throws for negative quoted fee', () => {
      expect(() => computeMaxFee(-1n)).toThrow('Quoted fee must be non-negative');
    });

    it('throws for invalid tolerance', () => {
      expect(() => computeMaxFee(25n, -1)).toThrow('Tolerance must be an integer between 0 and 10000 bps');
      expect(() => computeMaxFee(25n, 10001)).toThrow('Tolerance must be an integer between 0 and 10000 bps');
    });
  });

  describe('buildDepositWithMaxFeeArgs', () => {
    it('builds args with max fee', () => {
      const args = buildDepositWithMaxFeeArgs(
        {
          bounty_id: 1n,
          payer: 'G123',
          payee: 'G456',
          amount: 1000n,
          token: 'GABC',
          release_condition: { OnCompletion: null },
        },
        25n,
        0,
      );
      expect(args.max_fee).toBe(25n);
    });

    it('throws for zero amount', () => {
      expect(() =>
        buildDepositWithMaxFeeArgs(
          {
            bounty_id: 1n,
            payer: 'G123',
            payee: 'G456',
            amount: 0n,
            token: 'GABC',
            release_condition: { OnCompletion: null },
          },
          25n,
        ),
      ).toThrow('Deposit amount must be positive');
    });
  });
});