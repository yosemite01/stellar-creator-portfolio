# Service Discovery Architecture (#1756)

## Summary

In previous iterations, the platform included a HashiCorp Consul client for microservice discovery alongside static environment mappings. In cloud-native Kubernetes environments, native CoreDNS resolution provides superior reliability without requiring Consul agents or additional control-plane clusters.

## Discovery Strategy

1. **Local Development & Docker Compose**:
   - Uses `StaticDiscovery` via environment variables (`STELLAR_API_URL`, `STELLAR_AUTH_URL`, etc.).
   - No Consul daemon or container required to run locally.

2. **Kubernetes & Production**:
   - Uses `K8sDnsDiscovery`.
   - Resolves service names using standard in-cluster DNS:
     `<service-name>.<namespace>.svc.cluster.local`.
   - Service health checks are performed natively via Kubernetes readiness and liveness probes defined in Helm subcharts.

3. **Consul Deprecation**:
   - Consul HTTP client is deprecated and optional; retained only if explicit `CONSUL_HTTP_ADDR` is provided.
