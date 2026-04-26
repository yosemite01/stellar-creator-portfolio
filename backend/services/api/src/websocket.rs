use crate::ApiResponse;
use actix_web::{web, HttpRequest, HttpResponse};
use actix_ws::Message as WsMessage;
use futures::StreamExt;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

const DEFAULT_WS_MAX_CONNECTIONS_PER_IP: usize = 10;
const DEFAULT_WS_MAX_CONNECTIONS_GLOBAL: usize = 500;

#[derive(Clone)]
pub struct WsConnectionLimiter {
    per_ip_limit: usize,
    global_limit: usize,
    active_connections: Arc<AtomicUsize>,
    rejected_connections: Arc<AtomicUsize>,
    per_ip_connections: Arc<Mutex<HashMap<String, usize>>>,
}

#[derive(Clone, Debug)]
struct WsConnectionLease {
    limiter: WsConnectionLimiter,
    client_ip: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WsMetrics {
    pub active_connections: usize,
    pub rejected_connections: usize,
    pub global_limit: usize,
    pub per_ip_limit: usize,
}

impl WsConnectionLimiter {
    pub fn from_env() -> Self {
        let per_ip_limit = std::env::var("WS_MAX_CONNECTIONS_PER_IP")
            .ok()
            .and_then(|v| v.parse::<usize>().ok())
            .filter(|v| (1..=1000).contains(v))
            .unwrap_or(DEFAULT_WS_MAX_CONNECTIONS_PER_IP);

        let global_limit = std::env::var("WS_MAX_CONNECTIONS_GLOBAL")
            .ok()
            .and_then(|v| v.parse::<usize>().ok())
            .filter(|v| (1..=10000).contains(v))
            .unwrap_or(DEFAULT_WS_MAX_CONNECTIONS_GLOBAL);

        WsConnectionLimiter {
            per_ip_limit,
            global_limit,
            active_connections: Arc::new(AtomicUsize::new(0)),
            rejected_connections: Arc::new(AtomicUsize::new(0)),
            per_ip_connections: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn metrics(&self) -> WsMetrics {
        WsMetrics {
            active_connections: self.active_connections.load(Ordering::Relaxed),
            rejected_connections: self.rejected_connections.load(Ordering::Relaxed),
            global_limit: self.global_limit,
            per_ip_limit: self.per_ip_limit,
        }
    }

    fn acquire(&self, client_ip: &str) -> Result<WsConnectionLease, String> {
        let mut per_ip = self.per_ip_connections.lock().unwrap();
        let current_global = self.active_connections.load(Ordering::Relaxed);

        if current_global >= self.global_limit {
            self.rejected_connections.fetch_add(1, Ordering::Relaxed);
            return Err(format!(
                "global connection limit exceeded (limit={}, active={})",
                self.global_limit, current_global
            ));
        }

        let current_ip = per_ip.get(client_ip).copied().unwrap_or(0);
        if current_ip >= self.per_ip_limit {
            self.rejected_connections.fetch_add(1, Ordering::Relaxed);
            return Err(format!(
                "per-IP connection limit exceeded for {} (limit={}, active={})",
                client_ip, self.per_ip_limit, current_ip
            ));
        }

        per_ip.insert(client_ip.to_string(), current_ip + 1);
        self.active_connections.fetch_add(1, Ordering::Relaxed);

        Ok(WsConnectionLease {
            limiter: self.clone(),
            client_ip: client_ip.to_string(),
        })
    }

    fn release(&self, client_ip: &str) {
        let mut per_ip = self.per_ip_connections.lock().unwrap();

        if let Some(count) = per_ip.get_mut(client_ip) {
            if *count <= 1 {
                per_ip.remove(client_ip);
            } else {
                *count -= 1;
            }
            self.active_connections.fetch_sub(1, Ordering::Relaxed);
        }
    }
}

impl Drop for WsConnectionLease {
    fn drop(&mut self) {
        self.limiter.release(&self.client_ip);
    }
}

pub async fn websocket_metrics(limiter: web::Data<WsConnectionLimiter>) -> HttpResponse {
    HttpResponse::Ok().json(ApiResponse::ok(limiter.metrics(), None))
}

pub async fn ws_handler(
    req: HttpRequest,
    stream: web::Payload,
    limiter: web::Data<WsConnectionLimiter>,
) -> Result<HttpResponse, actix_web::Error> {
    let client_ip = req
        .peer_addr()
        .map(|addr| addr.ip().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    let lease = match limiter.acquire(&client_ip) {
        Ok(lease) => lease,
        Err(reason) => {
            tracing::warn!(
                "WebSocket connection rejected: client_ip={}, reason={}",
                client_ip,
                reason
            );
            return Ok(HttpResponse::TooManyRequests().json(ApiResponse::<()>::err(
                crate::ApiError::new(
                    crate::ApiErrorCode::ServiceUnavailable,
                    format!("WebSocket connection rejected: {}", reason),
                ),
            )));
        }
    };

    let (response, mut session, mut msg_stream) = actix_ws::handle(&req, stream)?;
    tracing::info!("WebSocket connected: client_ip={}", client_ip);

    actix_web::rt::spawn(async move {
        let _lease = lease;

        while let Some(Ok(msg)) = msg_stream.next().await {
            match msg {
                WsMessage::Text(text) => {
                    let _ = session.text(text).await;
                }
                WsMessage::Ping(bytes) => {
                    let _ = session.pong(&bytes).await;
                }
                WsMessage::Close(_) => break,
                _ => {}
            }
        }

        tracing::info!("WebSocket disconnected: client_ip={}", client_ip);
    });

    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limiter_enforces_per_ip_and_global_caps() {
        let limiter = WsConnectionLimiter {
            per_ip_limit: 2,
            global_limit: 3,
            active_connections: Arc::new(AtomicUsize::new(0)),
            rejected_connections: Arc::new(AtomicUsize::new(0)),
            per_ip_connections: Arc::new(Mutex::new(HashMap::new())),
        };

        let a1 = limiter.acquire("1.1.1.1").expect("first connection should pass");
        let a2 = limiter.acquire("1.1.1.1").expect("second connection should pass");
        let b1 = limiter.acquire("2.2.2.2").expect("global third connection should pass");

        let per_ip_reject = limiter.acquire("1.1.1.1");
        assert!(per_ip_reject.is_err());

        let global_reject = limiter.acquire("3.3.3.3");
        assert!(global_reject.is_err());
        assert_eq!(limiter.metrics().active_connections, 3);
        assert_eq!(limiter.metrics().rejected_connections, 2);

        drop(a1);
        drop(a2);
        drop(b1);
        assert_eq!(limiter.metrics().active_connections, 0);
    }
}
