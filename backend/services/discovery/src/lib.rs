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
pub mod k8s;
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
/// variables (#1756).
///
/// - If `KUBERNETES_SERVICE_HOST` or `DISCOVERY_TYPE=k8s` is set, uses native Kubernetes DNS.
/// - If `CONSUL_HTTP_ADDR` is set, returns a Consul-backed implementation.
/// - Otherwise, returns a static/env-based implementation (default for local dev).
pub async fn create_discovery() -> Result<Box<dyn ServiceDiscovery>> {
    if std::env::var("KUBERNETES_SERVICE_HOST").is_ok()
        || std::env::var("DISCOVERY_TYPE").as_deref() == Ok("k8s")
    {
        tracing::info!("Service discovery: Kubernetes DNS native resolution (#1756)");
        Ok(Box::new(k8s::K8sDnsDiscovery::new(None)))
    } else if let Ok(consul_addr) = std::env::var("CONSUL_HTTP_ADDR") {
        tracing::info!("Service discovery: Consul at {consul_addr}");
        let client = consul::ConsulDiscovery::new(&consul_addr)?;
        Ok(Box::new(client))
    } else {
        tracing::info!("Service discovery: static/env fallback (Consul dropped in dev, native k8s DNS in prod)");
        Ok(Box::new(r#static::StaticDiscovery::from_env()))
    }
}

// Re-export the async_trait macro so downstream crates don't need the dep.
pub use async_trait::async_trait;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn service_info_new_sets_fields_and_generates_unique_id() {
        let info = ServiceInfo::new("stellar-api", "127.0.0.1", 3001);
        assert!(info.id.starts_with("stellar-api-"));
        assert_eq!(info.name, "stellar-api");
        assert_eq!(info.address, "127.0.0.1");
        assert_eq!(info.port, 3001);
        assert!(info.tags.is_empty());

        let other = ServiceInfo::new("stellar-api", "127.0.0.1", 3001);
        assert_ne!(info.id, other.id, "each instance must get a unique id");
    }

    #[test]
    fn with_tags_replaces_the_tag_list() {
        let info = ServiceInfo::new("svc", "127.0.0.1", 3001)
            .with_tags(vec!["v1".to_string(), "primary".to_string()]);
        assert_eq!(info.tags, vec!["v1".to_string(), "primary".to_string()]);
    }

    // Both branches live in one test because they mutate the shared
    // CONSUL_HTTP_ADDR process env var; splitting them risks a race if the
    // test binary runs them concurrently.
    #[tokio::test]
    async fn create_discovery_picks_backend_from_env() {
        std::env::remove_var("CONSUL_HTTP_ADDR");
        let static_disc = create_discovery()
            .await
            .expect("static backend should construct without CONSUL_HTTP_ADDR");
        let info = ServiceInfo::new("probe", "10.0.0.5", 4000);
        static_disc
            .register(info.clone())
            .await
            .expect("static register works without any network access");
        let resolved = static_disc
            .resolve("probe")
            .await
            .expect("static resolve works without any network access");
        assert_eq!(resolved.map(|s| s.address), Some("10.0.0.5".to_string()));

        std::env::set_var("CONSUL_HTTP_ADDR", "http://127.0.0.1:8500");
        let consul_disc = create_discovery().await;
        std::env::remove_var("CONSUL_HTTP_ADDR");
        assert!(
            consul_disc.is_ok(),
            "picking the Consul backend must not require a reachable Consul server"
        );
    }

    #[tokio::test]
    async fn k8s_dns_discovery_resolves_service_names() {
        let disc = k8s::K8sDnsDiscovery::new(Some("stellar".to_string()));
        let resolved = disc.resolve("stellar-api").await.unwrap();
        assert!(resolved.is_some());
        let info = resolved.unwrap();
        assert_eq!(info.address, "stellar-api.stellar.svc.cluster.local");
        assert_eq!(info.port, 3001);
    }
}
