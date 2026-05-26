//! Static / environment-variable-based service discovery.
//!
//! Resolves services from a fixed mapping populated at startup.  This is the
//! default backend when Consul is not configured and works well for local
//! development, Docker Compose, and simple single-node deployments.
//!
//! Each service can be configured via environment variables following the
//! pattern `DISCOVERY_{NAME}_URL`, e.g.:
//!
//! ```text
//! DISCOVERY_STELLAR_API_URL=http://127.0.0.1:3001
//! DISCOVERY_STELLAR_AUTH_URL=http://127.0.0.1:8080
//! DISCOVERY_STELLAR_INDEXER_URL=http://127.0.0.1:9000
//! ```

use crate::{ServiceDiscovery, ServiceInfo};
use anyhow::Result;
use std::collections::HashMap;
use std::sync::RwLock;
use tracing::{debug, info};

/// Static service registry backed by an in-memory map.
pub struct StaticDiscovery {
    services: RwLock<HashMap<String, Vec<ServiceInfo>>>,
}

impl StaticDiscovery {
    /// Build a [`StaticDiscovery`] populated from `DISCOVERY_*_URL` environment
    /// variables and well-known service defaults.
    pub fn from_env() -> Self {
        let mut map: HashMap<String, Vec<ServiceInfo>> = HashMap::new();

        // Well-known defaults – overridden by DISCOVERY_*_URL when set.
        let defaults: Vec<(&str, &str, u16)> = vec![
            ("stellar-api", "127.0.0.1", 3001),
            ("stellar-auth", "127.0.0.1", 8080),
            ("stellar-indexer", "127.0.0.1", 9000),
            ("stellar-notifications", "127.0.0.1", 9001),
        ];

        for (name, default_addr, default_port) in defaults {
            let env_key = format!(
                "DISCOVERY_{}_URL",
                name.to_uppercase().replace('-', "_")
            );

            let (address, port) = if let Ok(url) = std::env::var(&env_key) {
                parse_host_port(&url).unwrap_or_else(|| {
                    tracing::warn!("Could not parse {env_key}={url}, using default");
                    (default_addr.to_string(), default_port)
                })
            } else {
                (default_addr.to_string(), default_port)
            };

            let info = ServiceInfo {
                id: format!("{name}-static"),
                name: name.to_string(),
                address,
                port,
                tags: vec!["static".to_string()],
            };

            debug!(service = %name, addr = %info.address, port = %info.port, "Static discovery entry");
            map.entry(name.to_string()).or_default().push(info);
        }

        info!("Static discovery loaded {} service(s)", map.len());
        Self {
            services: RwLock::new(map),
        }
    }
}

/// Extract `(host, port)` from a URL string like `http://host:port`.
fn parse_host_port(url: &str) -> Option<(String, u16)> {
    // Strip scheme
    let without_scheme = url
        .strip_prefix("http://")
        .or_else(|| url.strip_prefix("https://"))
        .unwrap_or(url);

    // Strip path
    let authority = without_scheme.split('/').next()?;

    if let Some((host, port_str)) = authority.rsplit_once(':') {
        let port = port_str.parse().ok()?;
        Some((host.to_string(), port))
    } else {
        None
    }
}

#[async_trait::async_trait]
impl ServiceDiscovery for StaticDiscovery {
    async fn register(&self, service: ServiceInfo) -> Result<()> {
        let mut map = self.services.write().map_err(|e| anyhow::anyhow!("lock poisoned: {e}"))?;
        info!(
            service_id = %service.id,
            service_name = %service.name,
            "Registered in static discovery"
        );
        map.entry(service.name.clone()).or_default().push(service);
        Ok(())
    }

    async fn deregister(&self, service_id: &str) -> Result<()> {
        let mut map = self.services.write().map_err(|e| anyhow::anyhow!("lock poisoned: {e}"))?;
        for instances in map.values_mut() {
            instances.retain(|s| s.id != service_id);
        }
        info!(service_id = %service_id, "Deregistered from static discovery");
        Ok(())
    }

    async fn resolve(&self, service_name: &str) -> Result<Option<ServiceInfo>> {
        let map = self.services.read().map_err(|e| anyhow::anyhow!("lock poisoned: {e}"))?;
        Ok(map.get(service_name).and_then(|v| v.first()).cloned())
    }

    async fn resolve_all(&self, service_name: &str) -> Result<Vec<ServiceInfo>> {
        let map = self.services.read().map_err(|e| anyhow::anyhow!("lock poisoned: {e}"))?;
        Ok(map.get(service_name).cloned().unwrap_or_default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_host_port_works() {
        assert_eq!(
            parse_host_port("http://127.0.0.1:3001"),
            Some(("127.0.0.1".to_string(), 3001))
        );
        assert_eq!(
            parse_host_port("http://consul:8500/v1"),
            Some(("consul".to_string(), 8500))
        );
        assert_eq!(parse_host_port("badurl"), None);
    }

    #[tokio::test]
    async fn static_register_and_resolve() {
        let disc = StaticDiscovery::from_env();
        let info = ServiceInfo::new("test-svc", "10.0.0.1", 8080);
        let id = info.id.clone();

        disc.register(info).await.unwrap();

        let resolved = disc.resolve("test-svc").await.unwrap();
        assert!(resolved.is_some());
        assert_eq!(resolved.unwrap().address, "10.0.0.1");

        disc.deregister(&id).await.unwrap();
    }

    #[tokio::test]
    async fn static_resolve_all_returns_multiple() {
        let disc = StaticDiscovery::from_env();
        disc.register(ServiceInfo::new("multi", "10.0.0.1", 8080))
            .await
            .unwrap();
        disc.register(ServiceInfo::new("multi", "10.0.0.2", 8080))
            .await
            .unwrap();

        let all = disc.resolve_all("multi").await.unwrap();
        assert_eq!(all.len(), 2);
    }
}
