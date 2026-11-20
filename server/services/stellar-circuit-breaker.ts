/**
 * Shared Circuit Breaker for Stellar & Outbound RPC calls (#1757)
 *
 * Implements the classic CLOSED → OPEN → HALF-OPEN state machine in TypeScript,
 * mirroring the configuration of the Rust `ServiceCircuitBreaker` in
 * `backend/services/common/src/circuit_breaker.rs`.
 *
 * Configuration:
 *   - failure_threshold : 5 consecutive failures → OPEN
 *   - recovery_timeout  : 30 s before entering HALF-OPEN
 *   - clock             : Injectable timestamp provider for unit testing
 *   - distributedStore  : Optional Redis-backed coordinator for cluster-wide trips
 */

import { metrics, type Meter, type Counter, type ObservableGauge } from '@opentelemetry/api';
import { withSpan, addEvent, setAttribute } from './tracing';

// ── Constants ──────────────────────────────────────────────────────────────

export const DEFAULT_FAILURE_THRESHOLD = 5;
export const DEFAULT_RECOVERY_TIMEOUT_MS = 30_000;

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

const STATE_VALUES: Record<CircuitState, number> = {
  CLOSED: 0,
  HALF_OPEN: 1,
  OPEN: 2,
};

export class CircuitOpenError extends Error {
  readonly httpStatus = 503;
  readonly retryAfterSeconds = 30;

  constructor(service: string) {
    super(`Circuit breaker OPEN for service "${service}" — service temporarily unavailable`);
    this.name = 'CircuitOpenError';
  }
}

export interface DistributedBreakerStore {
  isOpen(service: string): Promise<boolean>;
  trip(service: string, ttlMs: number): Promise<void>;
  reset(service: string): Promise<void>;
}

export interface CircuitBreakerOptions {
  serviceName?: string;
  failureThreshold?: number;
  recoveryTimeoutMs?: number;
  clock?: () => number;
  distributedStore?: DistributedBreakerStore;
}

export class StellarCircuitBreaker {
  readonly serviceName: string;
  readonly failureThreshold: number;
  readonly recoveryTimeoutMs: number;
  private readonly clock: () => number;
  private readonly distributedStore?: DistributedBreakerStore;

  private state: CircuitState = 'CLOSED';
  private consecutiveFailures = 0;
  private openedAt: number | null = null;
  private halfOpenProbeInFlight = false;

  // OTel metrics
  private readonly meter: Meter;
  private readonly stateTransitionCounter: Counter;
  private readonly rejectedCallsCounter: Counter;
  private currentStateValue: number = STATE_VALUES.CLOSED;

  constructor(options: string | CircuitBreakerOptions = 'stellar_rpc') {
    if (typeof options === 'string') {
      this.serviceName = options;
      this.failureThreshold = DEFAULT_FAILURE_THRESHOLD;
      this.recoveryTimeoutMs = DEFAULT_RECOVERY_TIMEOUT_MS;
      this.clock = () => Date.now();
    } else {
      this.serviceName = options.serviceName ?? 'stellar_rpc';
      this.failureThreshold = options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
      this.recoveryTimeoutMs = options.recoveryTimeoutMs ?? DEFAULT_RECOVERY_TIMEOUT_MS;
      this.clock = options.clock ?? (() => Date.now());
      this.distributedStore = options.distributedStore;
    }

    this.meter = metrics.getMeter('stellar-creator-portfolio', '1.0.0');

    this.stateTransitionCounter = this.meter.createCounter(
      'circuit_breaker_state_transitions_total',
      { description: 'Total number of circuit breaker state transitions' },
    );

    this.rejectedCallsCounter = this.meter.createCounter(
      'circuit_breaker_rejected_calls_total',
      { description: 'Total number of calls rejected by the open circuit breaker' },
    );

    const gauge: ObservableGauge = this.meter.createObservableGauge(
      'circuit_breaker_state',
      { description: 'Current circuit breaker state: 0=CLOSED, 1=HALF_OPEN, 2=OPEN' },
    );
    gauge.addCallback((result) => {
      result.observe(this.currentStateValue, { service: this.serviceName });
    });
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    return withSpan('stellar_rpc.circuit_breaker.execute', async (span) => {
      span.setAttribute('circuit_breaker.service', this.serviceName);
      span.setAttribute('circuit_breaker.state', this.state);

      await this.checkStateTransition();

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
        await this.onSuccess();
        return result;
      } catch (err) {
        await this.onFailure(err as Error);
        throw err;
      }
    });
  }

  getState(): CircuitState {
    this.checkLocalStateTransition();
    return this.state;
  }

  private checkLocalStateTransition(): void {
    if (
      this.state === 'OPEN' &&
      this.openedAt !== null &&
      this.clock() - this.openedAt >= this.recoveryTimeoutMs
    ) {
      this.transitionTo('HALF_OPEN');
    }
  }

  private async checkStateTransition(): Promise<void> {
    this.checkLocalStateTransition();

    if (this.distributedStore && this.state === 'CLOSED') {
      try {
        const clusterOpen = await this.distributedStore.isOpen(this.serviceName);
        if (clusterOpen) {
          this.transitionTo('OPEN');
        }
      } catch {
        // Fallback to local state if distributed store check errors
      }
    }
  }

  private async onSuccess(): Promise<void> {
    if (this.state === 'HALF_OPEN') {
      this.halfOpenProbeInFlight = false;
      this.transitionTo('CLOSED');
      if (this.distributedStore) {
        await this.distributedStore.reset(this.serviceName).catch(() => null);
      }
    }
    this.consecutiveFailures = 0;
    addEvent('circuit_breaker.call_succeeded', { service: this.serviceName });
    setAttribute('circuit_breaker.state', this.state);
  }

  private async onFailure(err: Error): Promise<void> {
    if (this.state === 'HALF_OPEN') {
      this.halfOpenProbeInFlight = false;
      this.transitionTo('OPEN');
      if (this.distributedStore) {
        await this.distributedStore.trip(this.serviceName, this.recoveryTimeoutMs).catch(() => null);
      }
      return;
    }

    this.consecutiveFailures++;
    addEvent('circuit_breaker.call_failed', {
      service: this.serviceName,
      consecutive_failures: String(this.consecutiveFailures),
      error: err.message,
    });

    if (this.consecutiveFailures >= this.failureThreshold) {
      this.transitionTo('OPEN');
      if (this.distributedStore) {
        await this.distributedStore.trip(this.serviceName, this.recoveryTimeoutMs).catch(() => null);
      }
    }
  }

  private transitionTo(newState: CircuitState): void {
    const previousState = this.state;
    if (previousState === newState) return;

    this.state = newState;
    this.currentStateValue = STATE_VALUES[newState];

    if (newState === 'OPEN') {
      this.openedAt = this.clock();
      this.consecutiveFailures = 0;
    } else if (newState === 'CLOSED') {
      this.openedAt = null;
      this.consecutiveFailures = 0;
    }

    this.stateTransitionCounter.add(1, {
      service: this.serviceName,
      from: previousState,
      to: newState,
    });

    addEvent('circuit_breaker.state_changed', {
      service: this.serviceName,
      from: previousState,
      to: newState,
    });
  }
}

export const stellarCircuitBreaker = new StellarCircuitBreaker('stellar_rpc');
