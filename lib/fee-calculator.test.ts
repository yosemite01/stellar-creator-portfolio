import { describe, it, expect } from 'vitest';
import {
  calculateFees,
  formatFeeBreakdown,
  PLATFORM_FEE_BPS,
  PLATFORM_FEE_CAP,
  NETWORK_FEE_XLM,
} from './fee-calculator';

describe('calculateFees', () => {
  it('returns zero breakdown for zero amount', () => {
    const result = calculateFees(0);
    expect(result.platformFee).toBe(0);
    expect(result.netAmount).toBe(0);
    expect(result.effectiveRate).toBe('0.00%');
  });

  it('returns zero breakdown for negative amount', () => {
    const result = calculateFees(-100);
    expect(result.platformFee).toBe(0);
    expect(result.netAmount).toBe(0);
  });

  it('applies 2.5% fee on small amounts', () => {
    const result = calculateFees(1000);
    expect(result.platformFee).toBeCloseTo(25, 5);
    expect(result.netAmount).toBeCloseTo(975, 5);
    expect(result.effectiveRate).toBe('2.50%');
  });

  it('caps platform fee at PLATFORM_FEE_CAP', () => {
    // 2.5% of 30000 = 750, but cap is 500
    const result = calculateFees(30_000);
    expect(result.platformFee).toBe(PLATFORM_FEE_CAP);
    expect(result.netAmount).toBe(30_000 - PLATFORM_FEE_CAP);
  });

  it('fee is exactly at cap boundary (20000 USDC → 2.5% = 500)', () => {
    const result = calculateFees(20_000);
    expect(result.platformFee).toBe(500);
    expect(result.effectiveRate).toBe('2.50%');
  });

  it('includes network fee for single operation', () => {
    const result = calculateFees(1000, 1);
    expect(result.networkFeeXlm).toBe(NETWORK_FEE_XLM);
  });

  it('scales network fee with operation count', () => {
    const result = calculateFees(1000, 3);
    expect(result.networkFeeXlm).toBeCloseTo(NETWORK_FEE_XLM * 3, 10);
  });

  it('grossAmount is preserved in breakdown', () => {
    const result = calculateFees(5000);
    expect(result.grossAmount).toBe(5000);
  });

  it('netAmount + platformFee === grossAmount', () => {
    for (const amount of [100, 1000, 10_000, 50_000]) {
      const r = calculateFees(amount);
      expect(r.netAmount + r.platformFee).toBeCloseTo(r.grossAmount, 5);
    }
  });

  it('PLATFORM_FEE_BPS constant is 250', () => {
    expect(PLATFORM_FEE_BPS).toBe(250);
  });

  it('PLATFORM_FEE_CAP constant is 500', () => {
    expect(PLATFORM_FEE_CAP).toBe(500);
  });
});

describe('formatFeeBreakdown', () => {
  it('includes all breakdown fields in output', () => {
    const breakdown = calculateFees(2000);
    const text = formatFeeBreakdown(breakdown);
    expect(text).toContain('Gross:');
    expect(text).toContain('Platform fee');
    expect(text).toContain('Net to payee:');
    expect(text).toContain('Network fee:');
    expect(text).toContain('XLM');
  });

  it('uses provided currency label', () => {
    const breakdown = calculateFees(1000);
    const text = formatFeeBreakdown(breakdown, 'USDC');
    expect(text).toContain('USDC');
  });
});
