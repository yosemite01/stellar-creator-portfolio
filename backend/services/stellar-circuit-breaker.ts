/**
 * Circuit Breaker for Stellar RPC calls
 *
 * Implements the classic CLOSED → OPEN → HALF-OPEN state machine in TypeScript,
 * mirroring the configuration of the Rust `ServiceCircuitBreaker` in
 * `backend/services/common/src/circuit_breaker.rs`.
 *
 * Configuration (matches `CircuitBreakerConfig::for_rpc()`):
 *   - failure_threshold : 5 consecutive failures → OPEN
 *   - recovery_timeout  : 30 s before entering HALF-OPEN
 *
 * OpenTelemetry integration:
 *   - Every state transition is recorded as a span event on the active span
 *   - A synthetic `circuit_breaker.state` attribute is set on each RPC span
 *   - A Prometheus-compatible counter (`circuit_breaker_state`) is emitted
 *     via the OTel Meter API so it appears as
 *     `circuit_breaker_state{service="stellar_rpc"}` in Prometheus.
 *
 * HTTP integration:
 *   - When OPEN, `execute()` throws `CircuitOpenError` which carries a 503
 *     status code and the `Retry-After` header value (30).
 */

import { metrics, type Meter, type Counter, type ObservableGauge } from '@opentelemetry/api';
import { withSpan, addEvent, setAttribute } from './tracing';

// ── Constants ──────────────────────────────────────────────────────────────

/** Matches `CircuitBreakerConfig::for_rpc()` in the Rust crate. */
const FAILURE_THRESHOLD = 5;
/** Recovery timeout in milliseconds (30 s). */
const RECOVERY_TIMEOUT_MS = 30_000;

// ── State ──────────────────────────────────────────────────────────────────

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/** Numeric encoding for Prometheus gauge: CLOSED=0, HALF_OPEN=1, OPEN=2 */
const STATE_VALUES: Record<CircuitState, number> = {
  CLOSED: 0,
  HALF_OPEN: 1,
  OPEN: 2,
};

// ── Error ──────────────────────────────────────────────────────────────────

/**
 * Thrown by `StellarCircuitBreaker.execute()` when the circuit is OPEN.
 * API handlers should catch this and return HTTP 503 with `Retry-After: 30`.
 */
export class CircuitOpenError extends Error {
  /** HTTP status code to forward to the client. */
  readonly httpStatus = 503;
  /** Value (in seconds) for the `Retry-After` response header. */
  readonly retryAfterSeconds = 30;

  constructor(service: string) {
    super(`Circuit breaker OPEN for service "${service}" — Stellar RPC unavailable`);
    this.name = 'CircuitOpenError';
  }
}

// ── Circuit Breaker ────────────────────────────────────────────────────────

/**
 * Thread-safe (single-process) circuit breaker for async Stellar RPC calls.
 *
 * Usage:
 * ```ts
 * const result = await stellarCircuitBreaker.execute(() => rpc.getAccount(key));
 * ```
 */
export class StellarCircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private consecutiveFailures = 0;
  /** Timestamp (ms) when the circuit moved to OPEN. */
  private openedAt: number | null = null;
  /** Whether a HALF-OPEN probe is currently in-flight. */
  private halfOpenProbeInFlight = false;

  // OTel metrics
  private readonly meter: Meter;
  private readonly stateTransitionCounter: Counter;
  private readonly rejectedCallsCounter: Counter;
  private currentStateValue: number = STATE_VALUES.CLOSED;

  constructor(private readonly serviceName: string = 'stellar_rpc') {
    this.meter = metrics.getMeter('stellar-creator-portfolio', '1.0.0');

    // Counter: incremented on every state transition
    this.stateTransitionCounter = this.meter.createCounter(
      'circuit_breaker_state_transitions_total',
      {
        description: 'Total number of circuit breaker state transitions',
      },
    );

    // Counter: calls rejected because circuit is OPEN
    this.rejectedCallsCounter = this.meter.createCounter(
      'circuit_breaker_rejected_calls_total',
      {
        description: 'Total number of calls rejected by the open circuit breaker',
      },
    );

    // Observable gauge: current state as a numeric value (0=CLOSED, 1=HALF_OPEN, 2=OPEN)
    // This surfaces as `circuit_breaker_state{service="stellar_rpc"}` in Prometheus.
    const gauge: ObservableGauge = this.meter.createObservableGauge(
      'circuit_breaker_state',
      {
        description:
          'Current circuit breaker state: 0=CLOSED, 1=HALF_OPEN, 2=OPEN',
      },
    );
    gauge.addCallback((result) => {
      result.observe(this.currentStateValue, { service: this.serviceName });
    });
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Execute `operation` through the circuit breaker.
   *
   * - CLOSED   → runs normally; failures increment counter
   * - OPEN     → throws `CircuitOpenError` immediately (no RPC call)
   * - HALF_OPEN → allows exactly one probe; success → CLOSED, fail → OPEN
   *
   * @throws {CircuitOpenError} when circuit is OPEN (caller should return HTTP 503)
   * @throws The original error from `operation` when the call fails in CLOSED/HALF_OPEN
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    return withSpan(
      `stellar_rpc.circuit_breaker.execute`,
      async (span) => {
        span.setAttribute('circuit_breaker.service', this.serviceName);
        span.setAttribute('circuit_breaker.state', this.state);

        this.checkStateTransition();

        if (this.state === 'OPEN') {
          this.rejectedCallsCounter.add(1, { service: this.serviceName });
          addEvent('circuit_breaker.rejected', {
            service: this.serviceName,
            state: this.state,
          });
          throw new CircuitOpenError(this.serviceName);
        }

        if (this.state === 'HALF_OPEN') {
          if (this.halfOpenProbeInFlight) {
            // Only one probe at a time; reject concurrent requests while probing
            this.rejectedCallsCounter.add(1, {
              service: this.serviceName,
              reason: 'half_open_probe_in_flight',
            });
            throw new CircuitOpenError(this.serviceName);
          }
          this.halfOpenProbeInFlight = true;
        }

        try {
          const result = await operation();
          this.onSuccess(span as any);
          return result;
        } catch (err) {
          this.onFailure(err as Error, span as any);
          throw err;
        }
      },
    );
  }

  /** Current circuit state (read-only). */
  getState(): CircuitState {
    this.checkStateTransition(); // refresh in case recovery timeout elapsed
    return this.state;
  }

  // ── Internal state machine ─────────────────────────────────────────────

  /**
   * Check whether the recovery timeout has elapsed for an OPEN circuit and, if
   * so, transition to HALF_OPEN to allow a probe request through.
   */
  private checkStateTransition(): void {
    if (
      this.state === 'OPEN' &&
      this.openedAt !== null &&
      Date.now() - this.openedAt >= RECOVERY_TIMEOUT_MS
    ) {
      this.transitionTo('HALF_OPEN');
    }
  }

  private onSuccess(_span: unknown): void {
    if (this.state === 'HALF_OPEN') {
      // Probe succeeded → close the circuit
      this.halfOpenProbeInFlight = false;
      this.transitionTo('CLOSED');
    }
    this.consecutiveFailures = 0;
    addEvent('circuit_breaker.call_succeeded', { service: this.serviceName });
    setAttribute('circuit_breaker.state', this.state);
  }

  private onFailure(err: Error, _span: unknown): void {
    if (this.state === 'HALF_OPEN') {
      // Probe failed → re-open immediately
      this.halfOpenProbeInFlight = false;
      this.transitionTo('OPEN');
      return;
    }

    this.consecutiveFailures++;
    addEvent('circuit_breaker.call_failed', {
      service: this.serviceName,
      consecutive_failures: String(this.consecutiveFailures),
      error: err.message,
    });

    if (this.consecutiveFailures >= FAILURE_THRESHOLD) {
      this.transitionTo('OPEN');
    }
  }

  private transitionTo(newState: CircuitState): void {
    const previousState = this.state;
    if (previousState === newState) return;

    this.state = newState;
    this.currentStateValue = STATE_VALUES[newState];

    if (newState === 'OPEN') {
      this.openedAt = Date.now();
      this.consecutiveFailures = 0;
    } else if (newState === 'CLOSED') {
      this.openedAt = null;
      this.consecutiveFailures = 0;
    }

    // OTel counter
    this.stateTransitionCounter.add(1, {
      service: this.serviceName,
      from: previousState,
      to: newState,
    });

    // OTel span event on the currently active span (if any)
    addEvent('circuit_breaker.state_changed', {
      service: this.serviceName,
      from: previousState,
      to: newState,
    });

    // Structured log (visible in OTel console exporter and Datadog/Jaeger)
    const level = newState === 'OPEN' ? 'warn' : 'info';
    console[level](
      `[CircuitBreaker] ${this.serviceName}: ${previousState} → ${newState}` +
        (newState === 'OPEN'
          ? ` (retry after ${RECOVERY_TIMEOUT_MS / 1000}s)`
          : ''),
    );
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────

/**
 * Singleton circuit breaker for Stellar RPC.
 * Import this in `services/api/stellar/client.ts` and wrap every `rpc.*` call.
 */
export const stellarCircuitBreaker = new StellarCircuitBreaker('stellar_rpc');
