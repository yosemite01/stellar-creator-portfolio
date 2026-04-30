# Circuit Breaker Tuning Guide

This guide provides instructions on how to tune the circuit breaker parameters for different types of services in the Stellar Creator Portfolio backend.

## Parameters

### 1. Failure Threshold (`failure_threshold`)

The `failure_threshold` defines how many **consecutive** failures must occur before the circuit breaker transitions from `Closed` to `Open`.

- **Low Threshold (2-3):** Use for critical services where even a few failures indicate a major issue (e.g., primary database). This provides fast failover but can be sensitive to transient network blips.
- **Moderate Threshold (5-10):** Use for internal services or caches where occasional failures are acceptable or expected under high load.
- **High Threshold (10+):** Use for non-critical background tasks or services with high inherent variability.

### 2. Recovery Timeout (`recovery_timeout`)

The `recovery_timeout` defines how long the circuit stays in the `Open` state before transitioning to `Half-Open`.

- **Short Timeout (5s - 10s):** Use for services that recover quickly, such as local caches or highly available microservices.
- **Moderate Timeout (30s):** The default for most RPC calls. It gives the downstream service enough time to stabilize without blocking traffic for too long.
- **Long Timeout (1m+):** Use for external third-party APIs or heavy database operations where recovery might involve manual intervention or significant startup time.

## Predefined Configurations

The `CircuitBreakerConfig` struct provides several factory methods for common scenarios:

| Scenario | `failure_threshold` | `recovery_timeout` | Rationale |
| :--- | :--- | :--- | :--- |
| **Database** | 3 | 10s | DB issues are critical; fail fast and check recovery frequently. |
| **Cache** | 5 | 5s | Caches are auxiliary; allow some failures but recover aggressively. |
| **RPC** | 5 | 30s | External services need more time to recover; avoid "thundering herd" issues. |

## Tuning Strategy

1. **Observe Baseline:** Monitor the normal failure rate of the service.
2. **Identify Impact:** Determine the cost of a failed call vs. the cost of a rejected call (circuit open).
3. **Set Initial Values:** Start with the predefined configurations.
4. **Iterate:**
    - If the circuit opens too often during normal operation (false positives), increase the `failure_threshold`.
    - If the circuit stays open too long after the service has recovered, decrease the `recovery_timeout`.
    - If the circuit doesn't open fast enough when a service goes down, decrease the `failure_threshold`.

## Best Practices

- **Consecutive vs. Percentage:** Our current implementation uses **consecutive** failures. This means a single successful call will reset the failure count. Keep this in mind when dealing with flaky services.
- **Logging:** Always monitor circuit breaker state transitions in the logs. Search for `circuit_breaker` tags in the service logs.
- **Fallbacks:** Always consider what the application should do when the circuit is open (e.g., return cached data, show a friendly error message, or use a degraded mode).
