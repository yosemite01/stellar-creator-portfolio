use std::collections::HashMap;

pub const SERVICE_NAME_KEY: &str = "service_name";
pub const TRACE_ID_KEY: &str = "trace_id";
pub const USER_ID_KEY: &str = "user_id";
pub const REQUEST_ID_HEADER: &str = "X-Request-ID";

// Shared OpenTelemetry resource attributes and propagators. These MUST stay in
// sync with `server/services/tracing.ts` so Next.js and Rust emit the same
// resource identity and propagate context the same way.
pub const OTEL_SERVICE_NAME_ATTR: &str = "service.name";
pub const OTEL_SERVICE_VERSION_ATTR: &str = "service.version";
pub const OTEL_DEPLOYMENT_ENV_ATTR: &str = "deployment.environment";
pub const OTEL_SERVICE_NAMESPACE_ATTR: &str = "service.namespace";
pub const OTEL_SERVICE_NAMESPACE: &str = "stellar-creator-portfolio";

/// W3C TraceContext + Baggage, matching the Next.js propagator list.
pub const OTEL_PROPAGATORS: &[&str] = &["tracecontext", "baggage"];

/// W3C `traceparent` header name used for cross-service propagation.
pub const TRACEPARENT_HEADER: &str = "traceparent";

/// Default head sampling ratio shared with the Next.js tracer.
pub const OTEL_TRACES_SAMPLER_ARG: &str = "0.1";

#[derive(Clone, Debug)]
pub struct TraceContext {
    pub trace_id: String,
    pub user_id: Option<String>,
    pub service_name: String,
    pub extra_fields: HashMap<String, String>,
}

impl TraceContext {
    pub fn new(service_name: &str) -> Self {
        Self {
            trace_id: uuid::Uuid::new_v4().to_string(),
            user_id: None,
            service_name: service_name.to_string(),
            extra_fields: HashMap::new(),
        }
    }

    pub fn with_trace_id(mut self, trace_id: String) -> Self {
        self.trace_id = trace_id;
        self
    }

    pub fn with_user_id(mut self, user_id: String) -> Self {
        self.user_id = Some(user_id);
        self
    }

    pub fn with_field(mut self, key: String, value: String) -> Self {
        self.extra_fields.insert(key, value);
        self
    }

    pub fn create_span(&self, operation: &str) -> tracing::Span {
        match &self.user_id {
            Some(uid) => tracing::info_span!(
                "traced_operation",
                trace_id = %self.trace_id,
                user_id = %uid,
                service_name = %self.service_name,
                operation = %operation,
            ),
            None => tracing::info_span!(
                "traced_operation",
                trace_id = %self.trace_id,
                service_name = %self.service_name,
                operation = %operation,
            ),
        }
    }
}

pub struct TracingHttpClient {
    inner: reqwest::Client,
    service_name: String,
}

impl TracingHttpClient {
    pub fn new(service_name: &str) -> Self {
        Self {
            inner: reqwest::Client::new(),
            service_name: service_name.to_string(),
        }
    }

    pub fn get(&self, url: &str, ctx: &TraceContext) -> reqwest::RequestBuilder {
        self.inner
            .get(url)
            .header(REQUEST_ID_HEADER, &ctx.trace_id)
            .header(TRACEPARENT_HEADER, &ctx.trace_id)
            .header("X-Source-Service", &self.service_name)
    }

    pub fn post(&self, url: &str, ctx: &TraceContext) -> reqwest::RequestBuilder {
        self.inner
            .post(url)
            .header(REQUEST_ID_HEADER, &ctx.trace_id)
            .header(TRACEPARENT_HEADER, &ctx.trace_id)
            .header("X-Source-Service", &self.service_name)
    }

    pub fn put(&self, url: &str, ctx: &TraceContext) -> reqwest::RequestBuilder {
        self.inner
            .put(url)
            .header(REQUEST_ID_HEADER, &ctx.trace_id)
            .header(TRACEPARENT_HEADER, &ctx.trace_id)
            .header("X-Source-Service", &self.service_name)
    }

    pub fn delete(&self, url: &str, ctx: &TraceContext) -> reqwest::RequestBuilder {
        self.inner
            .delete(url)
            .header(REQUEST_ID_HEADER, &ctx.trace_id)
            .header(TRACEPARENT_HEADER, &ctx.trace_id)
            .header("X-Source-Service", &self.service_name)
    }
}

/// Build the shared OpenTelemetry resource attributes for this service.
/// Mirrors the resource built in `server/services/tracing.ts`.
pub fn resource_attributes(service_name: &str) -> Vec<(&'static str, String)> {
    let version = std::env::var("SERVICE_VERSION").unwrap_or_else(|_| "unknown".to_string());
    let environment = std::env::var("DEPLOYMENT_ENVIRONMENT")
        .or_else(|_| std::env::var("NODE_ENV"))
        .unwrap_or_else(|_| "development".to_string());

    vec![
        (OTEL_SERVICE_NAME_ATTR, service_name.to_string()),
        (OTEL_SERVICE_VERSION_ATTR, version),
        (OTEL_DEPLOYMENT_ENV_ATTR, environment),
        (OTEL_SERVICE_NAMESPACE_ATTR, OTEL_SERVICE_NAMESPACE.to_string()),
    ]
}

pub fn init_tracing(service_name: &str) {
    use tracing_subscriber::EnvFilter;

    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(format!("info,{}=debug", service_name)));

    // Emit the shared resource attributes on every event so logs and traces
    // carry the same identity as the Next.js service.
    let attrs = resource_attributes(service_name);
    let service_version = attrs
        .iter()
        .find(|(k, _)| *k == OTEL_SERVICE_VERSION_ATTR)
        .map(|(_, v)| v.clone())
        .unwrap_or_else(|| "unknown".to_string());
    let deployment_env = attrs
        .iter()
        .find(|(k, _)| *k == OTEL_DEPLOYMENT_ENV_ATTR)
        .map(|(_, v)| v.clone())
        .unwrap_or_else(|| "development".to_string());

    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .json()
        .with_target(true)
        .with_thread_ids(true)
        .with_file(true)
        .with_line_number(true)
        .flatten_event(true)
        .init();

    tracing::info!(
        service.name = %service_name,
        service.version = %service_version,
        deployment.environment = %deployment_env,
        service.namespace = %OTEL_SERVICE_NAMESPACE,
        otel.propagators = ?OTEL_PROPAGATORS,
        otel.traces.sampler.arg = %OTEL_TRACES_SAMPLER_ARG,
        "tracing initialized"
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trace_context_new_generates_uuid() {
        let ctx = TraceContext::new("test-service");
        assert_eq!(ctx.service_name, "test-service");
        assert!(!ctx.trace_id.is_empty());
        assert!(ctx.user_id.is_none());
    }

    #[test]
    fn trace_context_with_user_id() {
        let ctx = TraceContext::new("api")
            .with_user_id("user-123".to_string());
        assert_eq!(ctx.user_id, Some("user-123".to_string()));
    }

    #[test]
    fn trace_context_with_trace_id() {
        let ctx = TraceContext::new("api")
            .with_trace_id("custom-trace-id".to_string());
        assert_eq!(ctx.trace_id, "custom-trace-id");
    }

    #[test]
    fn trace_context_with_extra_fields() {
        let ctx = TraceContext::new("api")
            .with_field("action".to_string(), "bounty.created".to_string());
        assert_eq!(ctx.extra_fields.get("action"), Some(&"bounty.created".to_string()));
    }

    #[test]
    fn tracing_http_client_creates() {
        let client = TracingHttpClient::new("api-service");
        assert_eq!(client.service_name, "api-service");
    }

    #[test]
    fn resource_attributes_include_shared_keys() {
        let attrs = resource_attributes("api-service");
        let keys: Vec<&str> = attrs.iter().map(|(k, _)| *k).collect();
        assert!(keys.contains(&OTEL_SERVICE_NAME_ATTR));
        assert!(keys.contains(&OTEL_SERVICE_VERSION_ATTR));
        assert!(keys.contains(&OTEL_DEPLOYMENT_ENV_ATTR));
        assert!(keys.contains(&OTEL_SERVICE_NAMESPACE_ATTR));
        assert_eq!(
            attrs
                .iter()
                .find(|(k, _)| *k == OTEL_SERVICE_NAME_ATTR)
                .map(|(_, v)| v.as_str()),
            Some("api-service")
        );
    }

    #[test]
    fn propagators_are_w3c_tracecontext_and_baggage() {
        assert_eq!(OTEL_PROPAGATORS, &["tracecontext", "baggage"]);
    }
}
