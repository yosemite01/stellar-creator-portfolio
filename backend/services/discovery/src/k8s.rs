//! Kubernetes DNS-based service discovery (#1756).
//!
//! In Kubernetes deployments, services are discovered using standard CoreDNS
//! names (`{service-name}.{namespace}.svc.cluster.local`). This eliminates
//! the external Consul agent dependency and failure modes.

use crate::{ServiceDiscovery, ServiceInfo};
use anyhow::Result;
use async_trait::async_trait;
use std::env;

pub struct K8sDnsDiscovery {
    namespace: String,
    domain: String,
}

impl K8sDnsDiscovery {
    pub fn new(namespace: Option<String>) -> Self {
        let ns = namespace
            .or_else(|| env::var("POD_NAMESPACE").ok())
            .unwrap_or_else(|| "default".to_string());
        let domain = env::var("K8S_CLUSTER_DOMAIN").unwrap_or_else(|_| "svc.cluster.local".to_string());

        Self {
            namespace: ns,
            domain,
        }
    }

    pub fn dns_name(&self, service_name: &str) -> String {
        format!("{}.{}.{}", service_name, self.namespace, self.domain)
    }

    pub fn default_port(&self, service_name: &str) -> u16 {
        match service_name {
            "stellar-api" => 3001,
            "stellar-auth" => 3002,
            "stellar-notifications" => 3003,
            "stellar-indexer" => 3004,
            "stellar-discovery" => 3005,
            _ => 80,
        }
    }
}

#[async_trait]
impl ServiceDiscovery for K8sDnsDiscovery {
    async fn register(&self, _service: ServiceInfo) -> Result<()> {
        // In Kubernetes, Service resources and Pod endpoints are managed by Kubernetes controllers
        Ok(())
    }

    async fn deregister(&self, _service_id: &str) -> Result<()> {
        Ok(())
    }

    async fn resolve(&self, service_name: &str) -> Result<Option<ServiceInfo>> {
        let host = self.dns_name(service_name);
        let port = self.default_port(service_name);
        Ok(Some(ServiceInfo::new(service_name, &host, port)))
    }

    async fn resolve_all(&self, service_name: &str) -> Result<Vec<ServiceInfo>> {
        match self.resolve(service_name).await? {
            Some(info) => Ok(vec![info]),
            None => Ok(Vec::new()),
        }
    }
}
