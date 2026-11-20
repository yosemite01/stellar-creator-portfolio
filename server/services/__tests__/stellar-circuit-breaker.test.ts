import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  StellarCircuitBreaker,
  CircuitOpenError,
  DEFAULT_FAILURE_THRESHOLD,
  DEFAULT_RECOVERY_TIMEOUT_MS,
} from '../stellar-circuit-breaker';

describe('StellarCircuitBreaker (#1757: Shared & Clock-mockable)', () => {
  let currentTime: number;
  const mockClock = () => currentTime;

  beforeEach(() => {
    currentTime = 100_000;
  });

  it('remains CLOSED and allows operations while below failure threshold', async () => {
    const breaker = new StellarCircuitBreaker({ clock: mockClock });
    expect(breaker.getState()).toBe('CLOSED');

    const result = await breaker.execute(async () => 'success');
    expect(result).toBe('success');
    expect(breaker.getState()).toBe('CLOSED');
  });

  it('transitions to OPEN after consecutive failures reach threshold', async () => {
    const breaker = new StellarCircuitBreaker({ clock: mockClock, failureThreshold: 3 });

    for (let i = 0; i < 3; i++) {
      await expect(
        breaker.execute(async () => {
          throw new Error('RPC down');
        }),
      ).rejects.toThrow('RPC down');
    }

    expect(breaker.getState()).toBe('OPEN');

    // Subsequent calls are rejected without executing the operation
    const op = vi.fn();
    await expect(breaker.execute(op)).rejects.toThrow(CircuitOpenError);
    expect(op).not.toHaveBeenCalled();
  });

  it('transitions from OPEN to HALF_OPEN after recovery timeout elapses', async () => {
    const breaker = new StellarCircuitBreaker({
      clock: mockClock,
      failureThreshold: 2,
      recoveryTimeoutMs: 30_000,
    });

    for (let i = 0; i < 2; i++) {
      await expect(breaker.execute(async () => { throw new Error('fail'); })).rejects.toThrow();
    }
    expect(breaker.getState()).toBe('OPEN');

    // Advance clock past recovery timeout
    currentTime += 30_001;
    expect(breaker.getState()).toBe('HALF_OPEN');

    // Successful probe closes the circuit
    await breaker.execute(async () => 'probe success');
    expect(breaker.getState()).toBe('CLOSED');
  });

  it('aligns with cluster-wide trip from distributed store', async () => {
    const mockStore = {
      isOpen: vi.fn().mockResolvedValue(true),
      trip: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn().mockResolvedValue(undefined),
    };

    const breaker = new StellarCircuitBreaker({
      clock: mockClock,
      distributedStore: mockStore,
    });

    await expect(breaker.execute(async () => 'ok')).rejects.toThrow(CircuitOpenError);
    expect(mockStore.isOpen).toHaveBeenCalled();
  });
});
