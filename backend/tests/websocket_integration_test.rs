//! WebSocket integration test using proper synchronization primitives.
//!
//! This test demonstrates the correct pattern for testing WebSocket connections:
//! - Uses `tokio::sync::Barrier` to coordinate client/server readiness
//! - Uses `tokio::sync::mpsc` channels for message passing
//! - Avoids timing-dependent logic (no `AtomicUsize` counters with sleep loops)
//!
//! The test validates:
//! 1. WebSocket connection establishment
//! 2. Bidirectional message exchange
//! 3. Graceful connection closure
//!
//! This approach is deterministic and stable across different system loads.

use actix_web::{web, App, HttpRequest, HttpResponse, HttpServer};
use actix_ws::Message as WsMessage;
use futures::StreamExt;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, Barrier};
use tokio::time::timeout;

// ── WebSocket Handler ─────────────────────────────────────────────────────────

/// Mock WebSocket handler that echoes messages back to the client.
///
/// Uses a barrier to signal when the connection is established and a channel
/// to notify when messages are received, ensuring deterministic test behavior.
async fn ws_handler(
    req: HttpRequest,
    stream: web::Payload,
    barrier: web::Data<Arc<Barrier>>,
    tx: web::Data<mpsc::UnboundedSender<String>>,
) -> Result<HttpResponse, actix_web::Error> {
    let (response, mut session, mut msg_stream) = actix_ws::handle(&req, stream)?;

    // Signal that the WebSocket connection is established
    barrier.wait().await;

    // Spawn a task to handle incoming messages
    actix_web::rt::spawn(async move {
        while let Some(Ok(msg)) = msg_stream.next().await {
            match msg {
                WsMessage::Text(text) => {
                    let text_str = text.to_string();
                    // Notify test that a message was received
                    let _ = tx.send(text_str.clone());
                    // Echo the message back
                    let _ = session.text(text_str).await;
                }
                WsMessage::Close(_) => break,
                _ => {}
            }
        }
    });

    Ok(response)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[actix_web::test]
async fn test_websocket_connection_and_echo() {
    // Barrier ensures both client and server are ready before proceeding
    let barrier = Arc::new(Barrier::new(2));
    let barrier_data = web::Data::new(barrier.clone());

    // Channel to receive messages from the WebSocket handler
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    let tx_data = web::Data::new(tx);

    // Start the test server
    let server = HttpServer::new(move || {
        App::new()
            .app_data(barrier_data.clone())
            .app_data(tx_data.clone())
            .route("/ws", web::get().to(ws_handler))
    })
    .bind(("127.0.0.1", 0))
    .expect("Failed to bind test server")
    .run();

    let addr = server.addrs()[0];
    let server_handle = actix_web::rt::spawn(server);

    // Give the server a moment to start
    tokio::time::sleep(Duration::from_millis(50)).await;

    // Connect WebSocket client
    let url = format!("ws://127.0.0.1:{}/ws", addr.port());
    let (mut ws_stream, _) = tokio_tungstenite::connect_async(&url)
        .await
        .expect("Failed to connect WebSocket client");

    // Wait for the server to signal connection establishment
    barrier.wait().await;

    // Send a test message
    let test_message = "Hello, WebSocket!";
    ws_stream
        .send(tokio_tungstenite::tungstenite::Message::Text(
            test_message.to_string(),
        ))
        .await
        .expect("Failed to send message");

    // Wait for the server to receive and process the message (via channel)
    let received = timeout(Duration::from_secs(2), rx.recv())
        .await
        .expect("Timeout waiting for message")
        .expect("Channel closed unexpectedly");

    assert_eq!(received, test_message, "Server should receive the sent message");

    // Wait for the echo response from the server
    let response = timeout(Duration::from_secs(2), ws_stream.next())
        .await
        .expect("Timeout waiting for echo")
        .expect("Stream ended unexpectedly")
        .expect("Failed to read message");

    match response {
        tokio_tungstenite::tungstenite::Message::Text(text) => {
            assert_eq!(text, test_message, "Server should echo the message back");
        }
        _ => panic!("Expected text message, got {:?}", response),
    }

    // Close the connection gracefully
    ws_stream
        .close(None)
        .await
        .expect("Failed to close WebSocket");

    // Stop the server
    server_handle.abort();
}

#[actix_web::test]
async fn test_websocket_multiple_messages() {
    let barrier = Arc::new(Barrier::new(2));
    let barrier_data = web::Data::new(barrier.clone());

    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    let tx_data = web::Data::new(tx);

    let server = HttpServer::new(move || {
        App::new()
            .app_data(barrier_data.clone())
            .app_data(tx_data.clone())
            .route("/ws", web::get().to(ws_handler))
    })
    .bind(("127.0.0.1", 0))
    .expect("Failed to bind test server")
    .run();

    let addr = server.addrs()[0];
    let server_handle = actix_web::rt::spawn(server);

    tokio::time::sleep(Duration::from_millis(50)).await;

    let url = format!("ws://127.0.0.1:{}/ws", addr.port());
    let (mut ws_stream, _) = tokio_tungstenite::connect_async(&url)
        .await
        .expect("Failed to connect WebSocket client");

    barrier.wait().await;

    // Send multiple messages and verify each is echoed
    let messages = vec!["Message 1", "Message 2", "Message 3"];

    for msg in &messages {
        ws_stream
            .send(tokio_tungstenite::tungstenite::Message::Text(
                msg.to_string(),
            ))
            .await
            .expect("Failed to send message");

        // Wait for server to receive via channel
        let received = timeout(Duration::from_secs(2), rx.recv())
            .await
            .expect("Timeout waiting for message")
            .expect("Channel closed unexpectedly");

        assert_eq!(&received, msg, "Server should receive message in order");

        // Wait for echo
        let response = timeout(Duration::from_secs(2), ws_stream.next())
            .await
            .expect("Timeout waiting for echo")
            .expect("Stream ended unexpectedly")
            .expect("Failed to read message");

        match response {
            tokio_tungstenite::tungstenite::Message::Text(text) => {
                assert_eq!(&text, msg, "Server should echo message in order");
            }
            _ => panic!("Expected text message, got {:?}", response),
        }
    }

    ws_stream.close(None).await.expect("Failed to close WebSocket");
    server_handle.abort();
}

#[actix_web::test]
async fn test_websocket_connection_close() {
    let barrier = Arc::new(Barrier::new(2));
    let barrier_data = web::Data::new(barrier.clone());

    let (tx, _rx) = mpsc::unbounded_channel::<String>();
    let tx_data = web::Data::new(tx);

    let server = HttpServer::new(move || {
        App::new()
            .app_data(barrier_data.clone())
            .app_data(tx_data.clone())
            .route("/ws", web::get().to(ws_handler))
    })
    .bind(("127.0.0.1", 0))
    .expect("Failed to bind test server")
    .run();

    let addr = server.addrs()[0];
    let server_handle = actix_web::rt::spawn(server);

    tokio::time::sleep(Duration::from_millis(50)).await;

    let url = format!("ws://127.0.0.1:{}/ws", addr.port());
    let (mut ws_stream, _) = tokio_tungstenite::connect_async(&url)
        .await
        .expect("Failed to connect WebSocket client");

    barrier.wait().await;

    // Close the connection immediately
    ws_stream
        .close(None)
        .await
        .expect("Failed to close WebSocket");

    // Verify the stream is closed
    let next_msg = ws_stream.next().await;
    assert!(
        next_msg.is_none(),
        "Stream should be closed after explicit close"
    );

    server_handle.abort();
}
