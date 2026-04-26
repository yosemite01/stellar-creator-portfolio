//! Consul-backed service discovery.
//!
//! Uses the Consul Agent HTTP API v1 to register / deregister services and
//! the Catalog/Health API to resolve healthy instances.

use crate::{ServiceDiscovery, ServiceInfo};
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use tracing::{debug, info, warn};

/// Consul service discovery client.
pub struct ConsulDiscovery {
    base_url: String,
    client: reqwest::Client,
}

/// Registration payload sent to `PUT /v1/agent/service/register`.
#[derive(Serialize)]
struct ConsulRegisterPayload {
    #[serde(rename = "ID")]
    id: String,
    #[serde(rename = "Name")]
    name: String,
    #[serde(rename = "Address")]
    address: String,
    #[serde(rename = "Port")]
    port: u16,
    #[serde(rename = "Tags")]
    tags: Vec<String>,
    #[serde(rename = "Check")]
    check: ConsulHealthCheck,
}

#[derive(Serialize)]
struct ConsulHealthCheck {
    #[serde(rename = "HTTP")]
    http: String,
    #[serde(rename = "Interval")]
    interval: String,
    #[serde(rename = "Timeout")]
    timeout: String,
    #[serde(rename = "DeregisterCriticalServiceAfter")]
    deregister_after: String,
}

/// A single entry returned by `GET /v1/health/service/:name?passing`.
#[derive(Deserialize)]
struct ConsulHealthEntry {
    #[serde(rename = "Service")]
    service: ConsulService,
}

#[derive(Deserialize)]
struct ConsulService {
    #[serde(rename = "ID")]
    id: String,
    #[serde(rename = "Service")]
    name: String,
    #[serde(rename = "Address")]
    address: String,
    #[serde(rename = "Port")]
    port: u16,
    #[serde(rename = "Tags")]
    tags: Option<Vec<String>>,
}

impl ConsulDiscovery {
    pub fn new(consul_addr: &str) -> Result<Self> {
        let base_url = consul_addr.trim_end_matches('/').to_string();
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .context("Failed to build HTTP client for Consul")?;
        Ok(Self { base_url, client })
    }
}

#[async_trait::async_trait]
impl ServiceDiscovery for ConsulDiscovery {
    async fn register(&self, service: ServiceInfo) -> Result<()> {
        let health_url = format!("http://{}:{}/health", service.address, service.port);

        let payload = ConsulRegisterPayload {
            id: service.id.clone(),
            name: service.name.clone(),
            address: service.address.clone(),
            port: service.port,
            tags: service.tags.clone(),
            check: ConsulHealthCheck {
                http: health_url,
                interval: "10s".to_string(),
                timeout: "5s".to_string(),
                deregister_after: "30s".to_string(),
            },
        };

        let url = format!("{}/v1/agent/service/register", self.base_url);
        let resp = self
            .client
            .put(&url)
            .json(&payload)
            .send()
            .await
            .context("Failed to register service with Consul")?;

        if resp.status().is_success() {
            info!(
                service_id = %service.id,
                service_name = %service.name,
                "Registered with Consul"
            );
            Ok(())
        } else {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("Consul registration failed ({status}): {body}");
        }
    }

    async fn deregister(&self, service_id: &str) -> Result<()> {
        let url = format!(
            "{}/v1/agent/service/deregister/{}",
            self.base_url, service_id
        );
        let resp = self
            .client
            .put(&url)
            .send()
            .await
            .context("Failed to deregister service from Consul")?;

        if resp.status().is_success() {
            info!(service_id = %service_id, "Deregistered from Consul");
            Ok(())
        } else {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            warn!("Consul deregistration failed ({status}): {body}");
            Ok(())
        }
    }

    async fn resolve(&self, service_name: &str) -> Result<Option<ServiceInfo>> {
        let instances = self.resolve_all(service_name).await?;
        // Return the first healthy instance (Consul already filters to passing).
        Ok(instances.into_iter().next())
    }

    async fn resolve_all(&self, service_name: &str) -> Result<Vec<ServiceInfo>> {
        let url = format!(
            "{}/v1/health/service/{}?passing",
            self.base_url, service_name
        );
        let resp = self
            .client
            .get(&url)
            .send()
            .await
            .context("Failed to query Consul for healthy services")?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("Consul health query failed ({status}): {body}");
        }

        let entries: Vec<ConsulHealthEntry> = resp
            .json()
            .await
            .context("Failed to parse Consul health response")?;

        debug!(
            service = %service_name,
            count = entries.len(),
            "Resolved healthy instances from Consul"
        );

        Ok(entries
            .into_iter()
            .map(|e| ServiceInfo {
                id: e.service.id,
                name: e.service.name,
                address: e.service.address,
                port: e.service.port,
                tags: e.service.tags.unwrap_or_default(),
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn consul_discovery_builds_base_url() {
        let d = ConsulDiscovery::new("http://consul:8500/").unwrap();
        assert_eq!(d.base_url, "http://consul:8500");
    }

    #[test]
    fn consul_discovery_trims_trailing_slash() {
        let d = ConsulDiscovery::new("http://localhost:8500").unwrap();
        assert_eq!(d.base_url, "http://localhost:8500");
    }
}
