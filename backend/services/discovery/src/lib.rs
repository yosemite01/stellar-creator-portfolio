//! Service discovery library for the Stellar platform.
//!
//! Provides a [`ServiceDiscovery`] trait with two backends:
//! - **Consul** – registers/deregisters services and resolves them via the
//!   Consul HTTP API (suitable for distributed deployments).
//! - **Static** – resolves services from environment variables or explicit
//!   mappings (suitable for local development and Docker Compose).
//!
//! # Quick start
//!
//! ```rust,ignore
//! use stellar_discovery::{create_discovery, ServiceInfo};
//!
//! let discovery = create_discovery().await?;
//!
//! // Register the current service
//! let info = ServiceInfo::new("stellar-api", "0.0.0.0", 3001);
//! discovery.register(info).await?;
//!
//! // Discover another service
//! if let Some(auth) = discovery.resolve("stellar-auth").await? {
//!     println!("Auth service at {}:{}", auth.address, auth.port);
//! }
//!
//! // Deregister on shutdown
//! discovery.deregister("stellar-api").await?;
//! ```

pub mod consul;
pub mod r#static;

use anyhow::Result;
use serde::{Deserialize, Serialize};

/// Metadata about a running service instance.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ServiceInfo {
    /// Unique instance ID (defaults to `{name}-{uuid}` if not provided).
    pub id: String,
    /// Logical service name (e.g. `"stellar-api"`).
    pub name: String,
    /// Address the service is reachable on.
    pub address: String,
    /// Port the service listens on.
    pub port: u16,
    /// Optional key-value tags for filtering (e.g. `["v1", "primary"]`).
    pub tags: Vec<String>,
}

impl ServiceInfo {
    pub fn new(name: &str, address: &str, port: u16) -> Self {
        Self {
            id: format!("{}-{}", name, uuid::Uuid::new_v4()),
            name: name.to_string(),
            address: address.to_string(),
            port,
            tags: Vec::new(),
        }
    }

    pub fn with_tags(mut self, tags: Vec<String>) -> Self {
        self.tags = tags;
        self
    }
}

/// Backend-agnostic service discovery interface.
///
/// Implementations handle registration, deregistration, and resolution of
/// services in the platform.
#[async_trait::async_trait]
pub trait ServiceDiscovery: Send + Sync {
    /// Register a service instance so other services can discover it.
    async fn register(&self, service: ServiceInfo) -> Result<()>;

    /// Remove a previously registered service instance.
    async fn deregister(&self, service_id: &str) -> Result<()>;

    /// Look up a healthy instance of the given service by logical name.
    /// Returns `None` if no instance is currently registered.
    async fn resolve(&self, service_name: &str) -> Result<Option<ServiceInfo>>;

    /// List all registered instances of a service.
    async fn resolve_all(&self, service_name: &str) -> Result<Vec<ServiceInfo>>;
}

/// Create the appropriate [`ServiceDiscovery`] backend based on environment
/// variables.
///
/// - If `CONSUL_HTTP_ADDR` is set, returns a Consul-backed implementation.
/// - Otherwise, returns a static/env-based implementation.
pub async fn create_discovery() -> Result<Box<dyn ServiceDiscovery>> {
    if let Ok(consul_addr) = std::env::var("CONSUL_HTTP_ADDR") {
        tracing::info!("Service discovery: Consul at {consul_addr}");
        let client = consul::ConsulDiscovery::new(&consul_addr)?;
        Ok(Box::new(client))
    } else {
        tracing::info!("Service discovery: static/env fallback (set CONSUL_HTTP_ADDR to enable Consul)");
        Ok(Box::new(r#static::StaticDiscovery::from_env()))
    }
}

// Re-export the async_trait macro so downstream crates don't need the dep.
pub use async_trait::async_trait;
