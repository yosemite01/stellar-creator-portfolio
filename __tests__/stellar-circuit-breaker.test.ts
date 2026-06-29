/**
 * Unit tests for the Stellar RPC circuit breaker
 * (backend/services/stellar-circuit-breaker.ts)
 *
 * Acceptance criteria verified here:
 *   ✓ 5 consecutive RPC failures open the circuit
 *   ✓ Open circuit returns 503 without hitting the RPC endpoint
 *   ✓ Circuit closes after 1 successful probe (HALF-OPEN → CLOSED)
 *   ✓ Failed HALF-OPEN probe re-opens the circuit
 *   ✓ Circuit transitions OPEN → HALF-OPEN after recovery timeout
 *   ✓ CircuitOpenError carries httpStatus=503 and retryAfterSeconds=30
 *   ✓ OTel metrics: stateTransitionCounter and rejectedCallsCounter are called
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock @opentelemetry/api before importing the module under test ─────────

const mockAdd = vi.fn();
const mockAddCallback = vi.fn();
const mockObserve = vi.fn();

vi.mock('@opentelemetry/api', () => ({
  metrics: {
    getMeter: () => ({
      createCounter: () => ({ add: mockAdd }),
      createObservableGauge: () => ({ addCallback: mockAddCallback }),
    }),
  },
}));

// ── Mock tracing helpers ───────────────────────────────────────────────────

vi.mock('@/backend/services/tracing', () => ({
  withSpan: async (_name: string, fn: (span: unknown) => Promise<unknown>) => {
    // Execute fn with a minimal stub span
    return fn({
      setAttribute: vi.fn(),
      setStatus: vi.fn(),
      recordException: vi.fn(),
      end: vi.fn(),
    });
  },
  addEvent: vi.fn(),
  setAttribute: vi.fn(),
}));

// ── Import after mocks are in place ───────────────────────────────────────

import {
  StellarCircuitBreaker,
  CircuitOpenError,
} from '@/backend/services/stellar-circuit-breaker';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Returns a fresh breaker instance for each test (avoids shared state). */
function makeBreaker() {
  return new StellarCircuitBreaker('test_stellar_rpc');
}

const failingOp = () => Promise.reject(new Error('RPC timeout'));
const successOp = () => Promise.resolve('ok');

// ── Tests ─────────────────────────────────────────────────────────────────

describe('StellarCircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockAdd.mockClear();
    mockAddCallback.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── CLOSED state ─────────────────────────────────────────────────────────

  describe('CLOSED state', () => {
    it('passes through successful operations', async () => {
      const cb = makeBreaker();
      const result = await cb.execute(() => Promise.resolve(42));
      expect(result).toBe(42);
      expect(cb.getState()).toBe('CLOSED');
    });

    it('re-throws errors from the operation without opening on < threshold failures', async () => {
      const cb = makeBreaker();
      for (let i = 0; i < 4; i++) {
        await expect(cb.execute(failingOp)).rejects.toThrow('RPC timeout');
      }
      expect(cb.getState()).toBe('CLOSED');
    });

    it('opens the circuit after exactly 5 consecutive failures', async () => {
      const cb = makeBreaker();
      for (let i = 0; i < 5; i++) {
        await expect(cb.execute(failingOp)).rejects.toThrow('RPC timeout');
      }
      expect(cb.getState()).toBe('OPEN');
    });

    it('resets the failure counter after a success', async () => {
      const cb = makeBreaker();
      // 4 failures then 1 success
      for (let i = 0; i < 4; i++) {
        await expect(cb.execute(failingOp)).rejects.toThrow();
      }
      await cb.execute(successOp);
      // 4 more failures — should NOT yet open (counter was reset)
      for (let i = 0; i < 4; i++) {
        await expect(cb.execute(failingOp)).rejects.toThrow('RPC timeout');
      }
      expect(cb.getState()).toBe('CLOSED');
    });
  });

  // ── OPEN state ────────────────────────────────────────────────────────────

  describe('OPEN state', () => {
    async function openCircuit(cb: StellarCircuitBreaker) {
      for (let i = 0; i < 5; i++) {
        await expect(cb.execute(failingOp)).rejects.toThrow();
      }
    }

    it('rejects calls immediately without invoking the operation', async () => {
      const cb = makeBreaker();
      await openCircuit(cb);

      const spy = vi.fn(() => Promise.resolve('should not be called'));
      await expect(cb.execute(spy)).rejects.toBeInstanceOf(CircuitOpenError);
      expect(spy).not.toHaveBeenCalled();
    });

    it('CircuitOpenError has httpStatus=503', async () => {
      const cb = makeBreaker();
      await openCircuit(cb);

      try {
        await cb.execute(successOp);
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(CircuitOpenError);
        expect((err as CircuitOpenError).httpStatus).toBe(503);
      }
    });

    it('CircuitOpenError has retryAfterSeconds=30', async () => {
      const cb = makeBreaker();
      await openCircuit(cb);

      try {
        await cb.execute(successOp);
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as CircuitOpenError).retryAfterSeconds).toBe(30);
      }
    });

    it('transitions to HALF_OPEN after 30 s recovery timeout', async () => {
      const cb = makeBreaker();
      await openCircuit(cb);
      expect(cb.getState()).toBe('OPEN');

      vi.advanceTimersByTime(30_000);

      expect(cb.getState()).toBe('HALF_OPEN');
    });

    it('does NOT transition before the 30 s window elapses', async () => {
      const cb = makeBreaker();
      await openCircuit(cb);

      vi.advanceTimersByTime(29_999);
      expect(cb.getState()).toBe('OPEN');
    });
  });

  // ── HALF-OPEN state ───────────────────────────────────────────────────────

  describe('HALF_OPEN state (probe)', () => {
    async function halfOpenCircuit(cb: StellarCircuitBreaker) {
      for (let i = 0; i < 5; i++) {
        await expect(cb.execute(failingOp)).rejects.toThrow();
      }
      vi.advanceTimersByTime(30_000);
      expect(cb.getState()).toBe('HALF_OPEN');
    }

    it('closes the circuit when the probe succeeds', async () => {
      const cb = makeBreaker();
      await halfOpenCircuit(cb);

      await cb.execute(successOp);
      expect(cb.getState()).toBe('CLOSED');
    });

    it('re-opens the circuit when the probe fails', async () => {
      const cb = makeBreaker();
      await halfOpenCircuit(cb);

      await expect(cb.execute(failingOp)).rejects.toThrow('RPC timeout');
      expect(cb.getState()).toBe('OPEN');
    });

    it('rejects concurrent requests while a probe is in-flight', async () => {
      const cb = makeBreaker();
      await halfOpenCircuit(cb);

      // First call — slow probe (never resolves during this test)
      let resolveProbe!: () => void;
      const probePromise = cb.execute(
        () => new Promise<string>((res) => { resolveProbe = () => res('done'); }),
      );

      // Second concurrent call — should be rejected with CircuitOpenError
      await expect(cb.execute(successOp)).rejects.toBeInstanceOf(CircuitOpenError);

      // Clean up the dangling probe
      resolveProbe();
      await probePromise;
    });
  });

  // ── OTel metrics ─────────────────────────────────────────────────────────

  describe('OTel metrics', () => {
    it('increments state transition counter when circuit opens', async () => {
      const cb = makeBreaker();
      for (let i = 0; i < 5; i++) {
        await expect(cb.execute(failingOp)).rejects.toThrow();
      }
      // The counter.add() should have been called for CLOSED→OPEN
      expect(mockAdd).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ from: 'CLOSED', to: 'OPEN' }),
      );
    });

    it('increments rejected calls counter when circuit is OPEN', async () => {
      const cb = makeBreaker();
      for (let i = 0; i < 5; i++) {
        await expect(cb.execute(failingOp)).rejects.toThrow();
      }
      mockAdd.mockClear(); // clear the transition counter calls

      await expect(cb.execute(successOp)).rejects.toBeInstanceOf(CircuitOpenError);

      expect(mockAdd).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ service: 'test_stellar_rpc' }),
      );
    });

    it('registers the observable gauge callback on construction', () => {
      makeBreaker();
      expect(mockAddCallback).toHaveBeenCalledTimes(1);
    });
  });
});
