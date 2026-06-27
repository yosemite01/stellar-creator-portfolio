use std::collections::HashMap;

pub const SERVICE_NAME_KEY: &str = "service_name";
pub const TRACE_ID_KEY: &str = "trace_id";
pub const USER_ID_KEY: &str = "user_id";
pub const REQUEST_ID_HEADER: &str = "X-Request-ID";

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
            .header("X-Source-Service", &self.service_name)
    }

    pub fn post(&self, url: &str, ctx: &TraceContext) -> reqwest::RequestBuilder {
        self.inner
            .post(url)
            .header(REQUEST_ID_HEADER, &ctx.trace_id)
            .header("X-Source-Service", &self.service_name)
    }

    pub fn put(&self, url: &str, ctx: &TraceContext) -> reqwest::RequestBuilder {
        self.inner
            .put(url)
            .header(REQUEST_ID_HEADER, &ctx.trace_id)
            .header("X-Source-Service", &self.service_name)
    }

    pub fn delete(&self, url: &str, ctx: &TraceContext) -> reqwest::RequestBuilder {
        self.inner
            .delete(url)
            .header(REQUEST_ID_HEADER, &ctx.trace_id)
            .header("X-Source-Service", &self.service_name)
    }
}

pub fn init_tracing(service_name: &str) {
    use tracing_subscriber::EnvFilter;

    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(format!("info,{}=debug", service_name)));

    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .json()
        .with_target(true)
        .with_thread_ids(true)
        .with_file(true)
        .with_line_number(true)
        .flatten_event(true)
        .init();
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
}
