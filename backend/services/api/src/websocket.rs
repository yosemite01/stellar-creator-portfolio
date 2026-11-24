use crate::ApiResponse;
use actix_web::{web, HttpRequest, HttpResponse};
use actix_ws::Message as WsMessage;
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::broadcast;
use tokio::time::{interval, timeout};

const DEFAULT_WS_MAX_CONNECTIONS_PER_IP: usize = 10;
const DEFAULT_WS_MAX_CONNECTIONS_GLOBAL: usize = 500;

/// How often to send a server-initiated ping (seconds).
const DEFAULT_WS_HEARTBEAT_SECS: u64 = 30;
/// How long to wait for a pong reply before closing the connection (seconds).
const DEFAULT_WS_PONG_DEADLINE_SECS: u64 = 10;
/// Close connections that receive no message for this long (seconds).
const DEFAULT_WS_IDLE_TIMEOUT_SECS: u64 = 300;

/// Default bounded per-connection outbound queue capacity.
const DEFAULT_WS_OUTBOUND_QUEUE_CAPACITY: usize = 256;
/// Default number of recent broadcast messages retained for resume.
const DEFAULT_WS_RESUME_BUFFER: usize = 1024;

#[derive(Clone, Debug)]
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
    pub dropped_messages: usize,
    pub last_sequence: u64,
}

/// A broadcast message with a monotonically increasing sequence number so
/// clients can resume from a last-seen sequence after reconnecting.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SequencedMessage {
    pub seq: u64,
    pub payload: serde_json::Value,
}

/// Fanout hub that distributes broadcast messages to all local connections
/// and (when configured) republishes them across instances via Redis pub/sub.
///
/// The hub keeps a bounded ring buffer of recent messages so a reconnecting
/// client can request a resume from its last-seen sequence number.
#[derive(Clone)]
pub struct WsHub {
    tx: broadcast::Sender<SequencedMessage>,
    next_seq: Arc<AtomicU64>,
    dropped_messages: Arc<AtomicUsize>,
    resume_buffer: Arc<Mutex<Vec<SequencedMessage>>>,
    resume_capacity: usize,
    outbound_capacity: usize,
}

impl WsHub {
    pub fn from_env() -> Self {
        let outbound_capacity = std::env::var("WS_OUTBOUND_QUEUE_CAPACITY")
            .ok()
            .and_then(|v| v.parse::<usize>().ok())
            .filter(|v| (1..=100_000).contains(v))
            .unwrap_or(DEFAULT_WS_OUTBOUND_QUEUE_CAPACITY);

        let resume_capacity = std::env::var("WS_RESUME_BUFFER")
            .ok()
            .and_then(|v| v.parse::<usize>().ok())
            .filter(|v| (1..=1_000_000).contains(v))
            .unwrap_or(DEFAULT_WS_RESUME_BUFFER);

        let (tx, _rx) = broadcast::channel(outbound_capacity);

        WsHub {
            tx,
            next_seq: Arc::new(AtomicU64::new(0)),
            dropped_messages: Arc::new(AtomicUsize::new(0)),
            resume_buffer: Arc::new(Mutex::new(Vec::with_capacity(resume_capacity))),
            resume_capacity,
            outbound_capacity,
        }
    }

    /// Publish a message to all local subscribers, assigning the next sequence
    /// number. Returns the sequenced message so callers can forward it to Redis
    /// for cross-instance fanout.
    pub fn publish(&self, payload: serde_json::Value) -> SequencedMessage {
        let seq = self.next_seq.fetch_add(1, Ordering::SeqCst) + 1;
        let msg = SequencedMessage { seq, payload };

        {
            let mut buf = self
                .resume_buffer
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            if buf.len() >= self.resume_capacity {
                buf.remove(0);
            }
            buf.push(msg.clone());
        }

        // A send error only means there are currently no subscribers; that is
        // not a failure for a broadcast hub.
        let _ = self.tx.send(msg.clone());
        msg
    }

    /// Ingest a message received from another instance via Redis pub/sub.
    /// The remote sequence is preserved so resume semantics stay consistent.
    pub fn ingest_remote(&self, msg: SequencedMessage) {
        self.next_seq.fetch_max(msg.seq, Ordering::SeqCst);
        {
            let mut buf = self
                .resume_buffer
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            if buf.len() >= self.resume_capacity {
                buf.remove(0);
            }
            buf.push(msg.clone());
        }
        let _ = self.tx.send(msg);
    }

    /// Return buffered messages with `seq > last_seen`, in order.
    pub fn resume_from(&self, last_seen: u64) -> Vec<SequencedMessage> {
        let buf = self
            .resume_buffer
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        buf.iter()
            .filter(|m| m.seq > last_seen)
            .cloned()
            .collect()
    }

    pub fn subscribe(&self) -> broadcast::Receiver<SequencedMessage> {
        self.tx.subscribe()
    }

    pub fn record_drop(&self) {
        self.dropped_messages.fetch_add(1, Ordering::Relaxed);
    }

    pub fn last_sequence(&self) -> u64 {
        self.next_seq.load(Ordering::SeqCst)
    }

    pub fn dropped_messages(&self) -> usize {
        self.dropped_messages.load(Ordering::Relaxed)
    }

    pub fn outbound_capacity(&self) -> usize {
        self.outbound_capacity
    }
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
            dropped_messages: 0,
            last_sequence: 0,
        }
    }

    fn acquire(&self, client_ip: &str) -> Result<WsConnectionLease, String> {
        let mut per_ip = self
            .per_ip_connections
            .lock()
            .unwrap_or_else(|e| e.into_inner());
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
        let mut per_ip = self
            .per_ip_connections
            .lock()
            .unwrap_or_else(|e| e.into_inner());

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

pub async fn websocket_metrics(
    limiter: web::Data<WsConnectionLimiter>,
    hub: web::Data<WsHub>,
) -> HttpResponse {
    let mut metrics = limiter.metrics();
    metrics.dropped_messages = hub.dropped_messages();
    metrics.last_sequence = hub.last_sequence();
    HttpResponse::Ok().json(ApiResponse::ok(metrics, None))
}

pub async fn ws_handler(
    req: HttpRequest,
    stream: web::Payload,
    limiter: web::Data<WsConnectionLimiter>,
    hub: web::Data<WsHub>,
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

    // Optional resume: `?lastSeq=N` replays buffered messages after N.
    let last_seq = req
        .query_string()
        .split('&')
        .find_map(|pair| pair.strip_prefix("lastSeq="))
        .and_then(|v| v.parse::<u64>().ok());

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

    let hub = hub.into_inner();
    let mut rx = hub.subscribe();

    actix_web::rt::spawn(async move {
        // _lease is held for the lifetime of this task; Drop releases the slot.
        let _lease = lease;

        // Replay any buffered messages the client missed before it reconnected.
        if let Some(last_seen) = last_seq {
            for msg in hub.resume_from(last_seen) {
                if let Ok(text) = serde_json::to_string(&msg) {
                    if session.text(text).await.is_err() {
                        return;
                    }
                }
            }
        }

        let mut heartbeat_tick = interval(Duration::from_secs(heartbeat_secs));
        // Skip the immediate first tick so we don't ping before the client
        // has had a chance to send anything.
        heartbeat_tick.tick().await;

        // Whether we are currently waiting for a pong reply.
        let mut awaiting_pong = false;

        loop {
            tokio::select! {
                // ── Broadcast fanout (bounded queue via broadcast channel) ──
                broadcast = rx.recv() => {
                    match broadcast {
                        Ok(msg) => {
                            if let Ok(text) = serde_json::to_string(&msg) {
                                if session.text(text).await.is_err() {
                                    break;
                                }
                            }
                        }
                        // Slow consumer: the bounded queue overflowed. Drop the
                        // message and record it; the client can resume via seq.
                        Err(broadcast::error::RecvError::Lagged(skipped)) => {
                            hub.record_drop();
                            tracing::warn!(
                                "WebSocket slow consumer: client_ip={}, skipped={}",
                                client_ip, skipped,
                            );
                        }
                        Err(broadcast::error::RecvError::Closed) => break,
                    }
                }
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
                            match msg {
                                WsMessage::Ping(bytes) => {
                                    if session.pong(&bytes).await.is_err() {
                                        break;
                                    }
                                }
                                WsMessage::Pong(_) => {
                                    awaiting_pong = false;
                                }
                                WsMessage::Close(_) => {
                                    let _ = session.close(None).await;
                                    break;
                                }
                                _ => {}
                            }
                        }
                    }
                }
                // ── Heartbeat / pong deadline ───────────────────────────────
                _ = heartbeat_tick.tick() => {
                    if awaiting_pong {
                        tracing::warn!(
                            "WebSocket pong deadline exceeded ({}s): client_ip={}",
                            pong_deadline_secs,
                            client_ip,
                        );
                        let _ = session.close(None).await;
                        break;
                    }
                    if session.ping(b"").await.is_err() {
                        break;
                    }
                    awaiting_pong = true;
                }
            }
        }
    });

    Ok(response)
}
