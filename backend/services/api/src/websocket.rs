use crate::ApiResponse;
use actix_web::{web, HttpRequest, HttpResponse};
use actix_ws::Message as WsMessage;
use futures::StreamExt;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::time::{interval, timeout};

const DEFAULT_WS_MAX_CONNECTIONS_PER_IP: usize = 10;
const DEFAULT_WS_MAX_CONNECTIONS_GLOBAL: usize = 500;

/// How often to send a server-initiated ping (seconds).
const DEFAULT_WS_HEARTBEAT_SECS: u64 = 30;
/// How long to wait for a pong reply before closing the connection (seconds).
const DEFAULT_WS_PONG_DEADLINE_SECS: u64 = 10;
/// Close connections that receive no message for this long (seconds).
const DEFAULT_WS_IDLE_TIMEOUT_SECS: u64 = 300;

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

    // Read timeout configuration from environment, falling back to defaults.
    let heartbeat_secs = std::env::var("WS_HEARTBEAT_SECS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(DEFAULT_WS_HEARTBEAT_SECS);

    let pong_deadline_secs = std::env::var("WS_PONG_DEADLINE_SECS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(DEFAULT_WS_PONG_DEADLINE_SECS);

    let idle_timeout_secs = std::env::var("WS_IDLE_TIMEOUT_SECS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(DEFAULT_WS_IDLE_TIMEOUT_SECS);

    actix_web::rt::spawn(async move {
        // _lease is held for the lifetime of this task; Drop releases the slot.
        let _lease = lease;

        let mut heartbeat_tick = interval(Duration::from_secs(heartbeat_secs));
        // Skip the immediate first tick so we don't ping before the client
        // has had a chance to send anything.
        heartbeat_tick.tick().await;

        // Whether we are currently waiting for a pong reply.
        let mut awaiting_pong = false;

        loop {
            tokio::select! {
                // ── Incoming message with idle timeout ──────────────────────
                result = timeout(
                    Duration::from_secs(idle_timeout_secs),
                    msg_stream.next(),
                ) => {
                    match result {
                        // Idle timeout expired – no message received in time.
                        Err(_elapsed) => {
                            tracing::warn!(
                                "WebSocket idle timeout ({}s): client_ip={}",
                                idle_timeout_secs,
                                client_ip,
                            );
                            let _ = session.close(None).await;
                            break;
                        }
                        // Stream ended (client disconnected cleanly).
                        Ok(None) => break,
                        // Stream error.
                        Ok(Some(Err(e))) => {
                            tracing::warn!(
                                "WebSocket stream error: client_ip={}, err={}",
                                client_ip, e,
                            );
                            break;
                        }
                        // Normal message received.
                        Ok(Some(Ok(msg))) => {
                            // Any message resets the "awaiting pong" state so
                            // that a data frame arriving before the pong does
                            // not cause a false-positive termination.
                            awaiting_pong = false;

                            match msg {
                                WsMessage::Text(text) => {
                                    if session.text(text).await.is_err() {
                                        break;
                                    }
                                }
                                WsMessage::Binary(bytes) => {
                                    if session.binary(bytes).await.is_err() {
                                        break;
                                    }
                                }
                                WsMessage::Ping(bytes) => {
                                    if session.pong(&bytes).await.is_err() {
                                        break;
                                    }
                                }
                                // Client answered our ping – nothing extra to do;
                                // awaiting_pong was already cleared above.
                                WsMessage::Pong(_) => {}
                                WsMessage::Close(_) => {
                                    let _ = session.close(None).await;
                                    break;
                                }
                                _ => {}
                            }
                        }
                    }
                }

                // ── Heartbeat tick ───────────────────────────────────────────
                _ = heartbeat_tick.tick() => {
                    if awaiting_pong {
                        // Previous ping was never answered – zombie connection.
                        tracing::warn!(
                            "WebSocket pong deadline exceeded ({}s): client_ip={}",
                            pong_deadline_secs,
                            client_ip,
                        );
                        let _ = session.close(None).await;
                        break;
                    }

                    // Send ping; if the send itself fails the socket is gone.
                    if session.ping(b"").await.is_err() {
                        break;
                    }
                    awaiting_pong = true;

                    // Arm a deadline: if the next heartbeat tick fires and
                    // awaiting_pong is still true, we terminate above.
                    // For a tighter deadline we shrink the next interval.
                    heartbeat_tick.reset_after(Duration::from_secs(pong_deadline_secs));
                }
            }
        }

        tracing::info!("WebSocket disconnected: client_ip={}", client_ip);
        // _lease drops here, decrementing the connection counter.
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

    #[test]
    fn limiter_releases_slot_on_drop() {
        let limiter = WsConnectionLimiter {
            per_ip_limit: 1,
            global_limit: 1,
            active_connections: Arc::new(AtomicUsize::new(0)),
            rejected_connections: Arc::new(AtomicUsize::new(0)),
            per_ip_connections: Arc::new(Mutex::new(HashMap::new())),
        };

        {
            let _lease = limiter.acquire("10.0.0.1").expect("should acquire");
            assert_eq!(limiter.metrics().active_connections, 1);
            // lease drops here
        }

        assert_eq!(limiter.metrics().active_connections, 0);
        // Slot is free – should be acquirable again
        let _lease2 = limiter.acquire("10.0.0.1").expect("should re-acquire after drop");
        assert_eq!(limiter.metrics().active_connections, 1);
    }
}
