import { describe, expect, it } from 'vitest'
import { actualSlippageBps, calculateMinShares } from '@/lib/utils/yield-slippage'

describe('calculateMinShares', () => {
  it('applies the recommended min_shares formula', () => {
    // 1000 * (1 - 50/10_000) = 995
    expect(calculateMinShares({ expectedShares: 1000, maxSlippageBps: 50 })).toBe(995)
  })

  it('returns expectedShares unchanged at 0 bps tolerance', () => {
    expect(calculateMinShares({ expectedShares: 250, maxSlippageBps: 0 })).toBe(250)
  })

  it('returns 0 at 10_000 bps (100%) tolerance', () => {
    expect(calculateMinShares({ expectedShares: 250, maxSlippageBps: 10_000 })).toBe(0)
  })

  it('rejects a negative expectedShares', () => {
    expect(() => calculateMinShares({ expectedShares: -1, maxSlippageBps: 50 })).toThrow(RangeError)
  })

  it('rejects an out-of-range maxSlippageBps', () => {
    expect(() => calculateMinShares({ expectedShares: 100, maxSlippageBps: 10_001 })).toThrow(RangeError)
    expect(() => calculateMinShares({ expectedShares: 100, maxSlippageBps: -1 })).toThrow(RangeError)
  })
})

describe('actualSlippageBps', () => {
  it('computes the bps deviation between expected and actual shares', () => {
    expect(actualSlippageBps(1000, 990)).toBeCloseTo(100)
  })

  it('clamps to 0 when actual shares meet or exceed expected', () => {
    expect(actualSlippageBps(1000, 1000)).toBe(0)
    expect(actualSlippageBps(1000, 1010)).toBe(0)
  })

  it('returns 0 when expectedShares is 0', () => {
    expect(actualSlippageBps(0, 0)).toBe(0)
  })
})
