use failsafe::{backoff, failure_policy, CircuitBreaker, Config, Error as FailsafeError, StateMachine};
use failsafe::failure_policy::ConsecutiveFailures;
use std::iter::Repeat;
use std::sync::Arc;
use std::time::Duration;
use thiserror::Error;
use tracing::{debug, warn};

#[derive(Debug, Error)]
pub enum CircuitBreakerError {
    #[error("circuit breaker is open, service unavailable")]
    CircuitOpen,
    #[error("operation failed: {0}")]
    OperationFailed(String),
}

type BreakerPolicy = ConsecutiveFailures<Repeat<Duration>>;
type InnerBreaker = StateMachine<BreakerPolicy, ()>;

pub struct ServiceCircuitBreaker {
    name: String,
    breaker: Arc<InnerBreaker>,
}

impl ServiceCircuitBreaker {
    pub fn new(name: &str) -> Self {
        Self::with_config(name, CircuitBreakerConfig::default())
    }

    pub fn with_config(name: &str, config: CircuitBreakerConfig) -> Self {
        let backoff = backoff::constant(config.recovery_timeout);
        let policy = failure_policy::consecutive_failures(config.failure_threshold, backoff);
        let breaker = Config::new().failure_policy(policy).build();

        Self {
            name: name.to_string(),
            breaker: Arc::new(breaker),
        }
    }

    pub fn call<F, T, E>(&self, operation: F) -> Result<T, CircuitBreakerError>
    where
        F: FnOnce() -> Result<T, E>,
        E: std::fmt::Display,
    {
        match self.breaker.call(operation) {
            Ok(result) => {
                debug!(circuit_breaker = %self.name, "operation succeeded");
                Ok(result)
            }
            Err(FailsafeError::Rejected) => {
                warn!(
                    circuit_breaker = %self.name,
                    "circuit breaker is open, rejecting call"
                );
                Err(CircuitBreakerError::CircuitOpen)
            }
            Err(FailsafeError::Inner(e)) => {
                warn!(
                    circuit_breaker = %self.name,
                    error = %e,
                    "operation failed"
                );
                Err(CircuitBreakerError::OperationFailed(e.to_string()))
            }
        }
    }

    pub async fn call_async<F, T, E, Fut>(&self, operation: F) -> Result<T, CircuitBreakerError>
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = Result<T, E>>,
        E: std::fmt::Display,
    {
        if !self.breaker.is_call_permitted() {
            warn!(
                circuit_breaker = %self.name,
                "circuit breaker is open, rejecting call"
            );
            return Err(CircuitBreakerError::CircuitOpen);
        }

        match operation().await {
            Ok(result) => {
                self.breaker.on_success();
                debug!(circuit_breaker = %self.name, "operation succeeded");
                Ok(result)
            }
            Err(e) => {
                self.breaker.on_error();
                warn!(
                    circuit_breaker = %self.name,
                    error = %e,
                    "operation failed"
                );
                Err(CircuitBreakerError::OperationFailed(e.to_string()))
            }
        }
    }

    pub fn is_closed(&self) -> bool {
        self.breaker.is_call_permitted()
    }

    pub fn name(&self) -> &str {
        &self.name
    }
}

impl Clone for ServiceCircuitBreaker {
    fn clone(&self) -> Self {
        Self {
            name: self.name.clone(),
            breaker: Arc::clone(&self.breaker),
        }
    }
}

pub struct CircuitBreakerConfig {
    pub failure_threshold: u32,
    pub recovery_timeout: Duration,
}

impl Default for CircuitBreakerConfig {
    fn default() -> Self {
        Self {
            failure_threshold: 5,
            recovery_timeout: Duration::from_secs(30),
        }
    }
}

impl CircuitBreakerConfig {
    pub fn for_database() -> Self {
        Self {
            failure_threshold: 3,
            recovery_timeout: Duration::from_secs(10),
        }
    }

    pub fn for_cache() -> Self {
        Self {
            failure_threshold: 5,
            recovery_timeout: Duration::from_secs(5),
        }
    }

    pub fn for_rpc() -> Self {
        Self {
            failure_threshold: 5,
            recovery_timeout: Duration::from_secs(30),
        }
    }
}

pub struct CircuitBreakerRegistry {
    database: ServiceCircuitBreaker,
    cache: ServiceCircuitBreaker,
    rpc: ServiceCircuitBreaker,
}

impl CircuitBreakerRegistry {
    pub fn new(service_name: &str) -> Self {
        Self {
            database: ServiceCircuitBreaker::with_config(
                &format!("{}-database", service_name),
                CircuitBreakerConfig::for_database(),
            ),
            cache: ServiceCircuitBreaker::with_config(
                &format!("{}-cache", service_name),
                CircuitBreakerConfig::for_cache(),
            ),
            rpc: ServiceCircuitBreaker::with_config(
                &format!("{}-rpc", service_name),
                CircuitBreakerConfig::for_rpc(),
            ),
        }
    }

    pub fn database(&self) -> &ServiceCircuitBreaker {
        &self.database
    }

    pub fn cache(&self) -> &ServiceCircuitBreaker {
        &self.cache
    }

    pub fn rpc(&self) -> &ServiceCircuitBreaker {
        &self.rpc
    }
}

impl Clone for CircuitBreakerRegistry {
    fn clone(&self) -> Self {
        Self {
            database: self.database.clone(),
            cache: self.cache.clone(),
            rpc: self.rpc.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn circuit_breaker_allows_successful_calls() {
        let cb = ServiceCircuitBreaker::new("test");
        let result: Result<i32, CircuitBreakerError> = cb.call(|| Ok::<_, String>(42));
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 42);
    }

    #[test]
    fn circuit_breaker_records_failures() {
        let config = CircuitBreakerConfig {
            failure_threshold: 2,
            recovery_timeout: Duration::from_millis(100),
        };
        let cb = ServiceCircuitBreaker::with_config("test", config);

        for _ in 0..2 {
            let _ = cb.call(|| Err::<(), _>("error"));
        }

        assert!(!cb.is_closed());
    }

    #[test]
    fn circuit_breaker_opens_after_threshold() {
        let config = CircuitBreakerConfig {
            failure_threshold: 2,
            recovery_timeout: Duration::from_secs(60),
        };
        let cb = ServiceCircuitBreaker::with_config("test", config);

        for _ in 0..2 {
            let _ = cb.call(|| Err::<(), _>("error"));
        }

        let result: Result<(), CircuitBreakerError> = cb.call(|| Ok::<(), String>(()));
        assert!(matches!(result, Err(CircuitBreakerError::CircuitOpen)));
    }

    #[test]
    fn registry_provides_separate_breakers() {
        let registry = CircuitBreakerRegistry::new("test-service");

        assert_eq!(registry.database().name(), "test-service-database");
        assert_eq!(registry.cache().name(), "test-service-cache");
        assert_eq!(registry.rpc().name(), "test-service-rpc");
    }
}
