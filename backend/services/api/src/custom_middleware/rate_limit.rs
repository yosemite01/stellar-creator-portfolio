//! Redis-backed fixed-window rate limiting middleware for Actix-Web.
//!
//! Each request is keyed by `{prefix}:{client_ip}` and counted inside a
//! rolling window stored as a Redis key with a TTL equal to the window
//! duration. When the counter exceeds `max_requests` the middleware returns
//! 429 Too Many Requests immediately, before the request reaches any handler.
//!
//! # Per-route limits
//!
//! Instantiate `RateLimit` with a different `RateLimitConfig` for each route
//! group. The `prefix` field disambiguates keys between groups so a client
//! hitting `/api/bounties` does not share quota with `/health`.

use actix_web::{
    body::EitherBody,
    dev::{forward_ready, Service, ServiceRequest, ServiceResponse, Transform},
    http::StatusCode,
    Error, HttpResponse,
};
use deadpool_redis::Pool as RedisPool;
use futures::future::LocalBoxFuture;
use std::future::{ready, Ready};
use std::rc::Rc;
use std::sync::Arc;

// ── Configuration ─────────────────────────────────────────────────────────────

/// Configuration for a single rate-limit tier.
#[derive(Clone, Debug)]
pub struct RateLimitConfig {
    /// Redis key prefix — keeps different route groups independent.
    pub prefix: String,
    /// Maximum number of requests allowed per `window_secs`.
    pub max_requests: u64,
    /// Length of the counting window in seconds.
    pub window_secs: u64,
}

impl RateLimitConfig {
    pub fn new(prefix: impl Into<String>, max_requests: u64, window_secs: u64) -> Self {
        Self {
            prefix: prefix.into(),
            max_requests,
            window_secs,
        }
    }
}

// ── Middleware factory ─────────────────────────────────────────────────────────

/// Actix-Web middleware factory.  Wrap route groups with different configs:
///
/// ```rust
/// .service(
///     web::scope("/api")
///         .wrap(RateLimit::new(redis_pool.clone(), RateLimitConfig::new("api", 60, 60)))
///         .route("/bounties", web::post().to(create_bounty))
/// )
/// ```
pub struct RateLimit {
    redis: Arc<RedisPool>,
    config: Arc<RateLimitConfig>,
}

impl RateLimit {
    pub fn new(redis: RedisPool, config: RateLimitConfig) -> Self {
        Self {
            redis: Arc::new(redis),
            config: Arc::new(config),
        }
    }
}

impl<S, B> Transform<S, ServiceRequest> for RateLimit
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    B: 'static,
{
    type Response = ServiceResponse<EitherBody<B>>;
    type Error = Error;
    type InitError = ();
    type Transform = RateLimitMiddleware<S>;
    type Future = Ready<Result<Self::Transform, Self::InitError>>;

    fn new_transform(&self, service: S) -> Self::Future {
        ready(Ok(RateLimitMiddleware {
            service: Rc::new(service),
            redis: Arc::clone(&self.redis),
            config: Arc::clone(&self.config),
        }))
    }
}

// ── Inner service ─────────────────────────────────────────────────────────────

pub struct RateLimitMiddleware<S> {
    service: Rc<S>,
    redis: Arc<RedisPool>,
    config: Arc<RateLimitConfig>,
}

impl<S, B> Service<ServiceRequest> for RateLimitMiddleware<S>
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    B: 'static,
{
    type Response = ServiceResponse<EitherBody<B>>;
    type Error = Error;
    type Future = LocalBoxFuture<'static, Result<Self::Response, Self::Error>>;

    forward_ready!(service);

    fn call(&self, req: ServiceRequest) -> Self::Future {
        let service = Rc::clone(&self.service);
        let redis = Arc::clone(&self.redis);
        let config = Arc::clone(&self.config);

        Box::pin(async move {
            let client_ip = client_ip(&req);
            let redis_key = format!("rl:{}:{}", config.prefix, client_ip);

            match check_and_increment(&redis, &redis_key, config.max_requests, config.window_secs)
                .await
            {
                Ok(RateLimitResult::Allowed { remaining, reset_in }) => {
                    let svc_response = service.call(req).await?;
                    let mut res = svc_response.map_into_left_body();

                    // Attach informational headers so callers know their quota.
                    let headers = res.headers_mut();
                    insert_header(headers, "x-ratelimit-limit", config.max_requests);
                    insert_header(headers, "x-ratelimit-remaining", remaining);
                    insert_header(headers, "x-ratelimit-reset", reset_in);

                    Ok(res)
                }

                Ok(RateLimitResult::Exceeded { reset_in }) => {
                    tracing::warn!(
                        client_ip = %client_ip,
                        key = %redis_key,
                        reset_in = reset_in,
                        "Rate limit exceeded"
                    );

                    let body = serde_json::json!({
                        "error": "Too Many Requests",
                        "message": "Rate limit exceeded. Please slow down.",
                        "retry_after": reset_in,
                    });

                    let http_res = HttpResponse::build(StatusCode::TOO_MANY_REQUESTS)
                        .insert_header(("x-ratelimit-limit", config.max_requests.to_string()))
                        .insert_header(("x-ratelimit-remaining", "0"))
                        .insert_header(("x-ratelimit-reset", reset_in.to_string()))
                        .insert_header(("retry-after", reset_in.to_string()))
                        .json(body);

                    Ok(req.into_response(http_res).map_into_right_body())
                }

                Err(e) => {
                    // Redis failure — fail open to avoid blocking legitimate traffic,
                    // but log loudly so ops knows the limiter is degraded.
                    tracing::error!(
                        error = %e,
                        key = %redis_key,
                        "Rate limit Redis error — failing open"
                    );
                    let svc_response = service.call(req).await?;
                    Ok(svc_response.map_into_left_body())
                }
            }
        })
    }
}

// ── Redis logic ───────────────────────────────────────────────────────────────

enum RateLimitResult {
    Allowed { remaining: u64, reset_in: u64 },
    Exceeded { reset_in: u64 },
}

/// Atomically increment a counter in Redis, set a TTL on first touch, and
/// return whether the request is within the allowed quota.
///
/// Uses a Lua script so the INCR + EXPIRE pair is atomic even when multiple
/// API replicas race.
async fn check_and_increment(
    pool: &RedisPool,
    key: &str,
    max_requests: u64,
    window_secs: u64,
) -> Result<RateLimitResult, anyhow::Error> {
    let mut conn = pool.get().await?;

    // Lua: increment the key; on first touch set the TTL.
    // Returns [current_count, ttl_remaining].
    let script = r#"
        local count = redis.call('INCR', KEYS[1])
        if count == 1 then
            redis.call('EXPIRE', KEYS[1], ARGV[1])
        end
        local ttl = redis.call('TTL', KEYS[1])
        return {count, ttl}
    "#;

    let result: Vec<i64> = deadpool_redis::redis::Script::new(script)
        .key(key)
        .arg(window_secs as i64)
        .invoke_async(&mut conn)
        .await?;

    let count = result.first().copied().unwrap_or(1).max(0) as u64;
    let ttl = result.get(1).copied().unwrap_or(window_secs as i64).max(0) as u64;

    if count > max_requests {
        Ok(RateLimitResult::Exceeded { reset_in: ttl })
    } else {
        Ok(RateLimitResult::Allowed {
            remaining: max_requests.saturating_sub(count),
            reset_in: ttl,
        })
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Extract the best available client IP, preferring the first address from
/// `X-Forwarded-For` (set by reverse-proxies) and falling back to the
/// direct peer address.
fn client_ip(req: &ServiceRequest) -> String {
    req.headers()
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(',').next())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| {
            req.peer_addr()
                .map(|addr| addr.ip().to_string())
                .unwrap_or_else(|| "unknown".to_string())
        })
}

fn insert_header(
    headers: &mut actix_web::http::header::HeaderMap,
    name: &'static str,
    value: u64,
) {
    if let Ok(val) =
        actix_web::http::header::HeaderValue::from_str(&value.to_string())
    {
        headers.insert(
            actix_web::http::header::HeaderName::from_static(name),
            val,
        );
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rate_limit_config_new() {
        let cfg = RateLimitConfig::new("test", 100, 60);
        assert_eq!(cfg.prefix, "test");
        assert_eq!(cfg.max_requests, 100);
        assert_eq!(cfg.window_secs, 60);
    }

    #[test]
    fn rate_limit_config_clone() {
        let cfg = RateLimitConfig::new("api", 30, 60);
        let cloned = cfg.clone();
        assert_eq!(cloned.prefix, cfg.prefix);
        assert_eq!(cloned.max_requests, cfg.max_requests);
    }
}