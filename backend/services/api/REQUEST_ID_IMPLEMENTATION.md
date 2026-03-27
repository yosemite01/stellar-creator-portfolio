# Request ID Tracing Implementation

## Overview

This implementation adds request ID middleware to the Stellar API service, enabling distributed tracing and log correlation across services.

## Features

- **Automatic Request ID Generation**: Uses UUID v4 to generate unique request IDs
- **Header Propagation**: Accepts existing `X-Request-ID` headers from upstream services
- **Response Headers**: Includes request ID in all responses for client-side tracking
- **Tracing Integration**: Automatically adds request ID to all log entries within request scope
- **Request Extensions**: Stores request ID in Actix-Web extensions for easy handler access

## Architecture

### Middleware Flow

```
1. Request arrives → Extract or generate request ID
2. Store in request extensions
3. Create tracing span with request ID
4. Process request through handlers
5. Add request ID to response headers
6. Return response
```

### Components

#### `middleware/request_id.rs`
- `RequestId`: Transform middleware for Actix-Web
- `RequestIdMiddleware`: Service implementation
- `RequestIdExtension`: Type-safe storage in request extensions
- `get_request_id()`: Helper function to extract request ID from handlers

## Usage

### In Handlers

```rust
use actix_web::{HttpRequest, HttpResponse};
use crate::middleware::get_request_id;

async fn my_handler(req: HttpRequest) -> HttpResponse {
    let request_id = get_request_id(&req).unwrap_or_else(|| "unknown".to_string());
    
    tracing::info!(request_id = %request_id, "Processing request");
    
    // Your handler logic here
    
    HttpResponse::Ok().json(serde_json::json!({
        "data": "response",
        "request_id": request_id
    }))
}
```

### Logging with Request ID

The middleware automatically creates a tracing span with the request ID, so all logs within the request scope will include it:

```rust
tracing::info!("This log will include the request_id field");
tracing::error!("Error occurred"); // Also includes request_id
```

### Client Usage

Clients can provide their own request IDs for end-to-end tracing:

```bash
curl -H "X-Request-ID: my-custom-id-123" http://localhost:3001/health
```

The response will include the same ID:

```
X-Request-ID: my-custom-id-123
```

## Configuration

### Middleware Order

The RequestId middleware should be registered early in the middleware chain, before the Logger middleware:

```rust
App::new()
    .wrap(RequestId)              // First - generates/extracts request ID
    .wrap(middleware::Logger::default())  // Second - logs with request ID
    .wrap(middleware::NormalizePath::trim())
```

### Log Format

Configure tracing to include the request_id field:

```rust
tracing_subscriber::fmt()
    .with_env_filter("info,stellar_api=debug")
    .json()  // Optional: JSON format for structured logging
    .init();
```

## Benefits

### 1. Distributed Tracing
Track requests across multiple services by propagating the same request ID:

```
Frontend → API Gateway → Stellar API → Database
   |            |              |           |
   └────────────┴──────────────┴───────────┘
        Same X-Request-ID: abc-123
```

### 2. Log Correlation
Find all logs related to a specific request:

```bash
# Search logs by request ID
grep "request_id=abc-123" logs/stellar-api.log

# Or with structured logging
jq 'select(.request_id == "abc-123")' logs/stellar-api.json
```

### 3. Debugging
When users report issues, ask for the request ID from the response headers to quickly locate relevant logs.

### 4. Performance Monitoring
Track request latency and identify slow requests:

```rust
tracing::info!(
    request_id = %request_id,
    duration_ms = %duration.as_millis(),
    "Request completed"
);
```

## Testing

The middleware includes comprehensive tests:

```bash
# Run tests
cargo test --package stellar-api

# Run specific middleware tests
cargo test --package stellar-api request_id
```

### Test Coverage

- ✅ Generates UUID when no header present
- ✅ Accepts existing X-Request-ID header
- ✅ Adds request ID to response headers
- ✅ Request ID accessible in handlers via extensions

## Integration with Other Services

### Microservices Communication

When calling other services, propagate the request ID:

```rust
use reqwest::Client;

async fn call_other_service(request_id: &str) -> Result<(), Box<dyn std::error::Error>> {
    let client = Client::new();
    let response = client
        .get("http://other-service/api/endpoint")
        .header("X-Request-ID", request_id)
        .send()
        .await?;
    
    Ok(())
}
```

### Database Queries

Include request ID in database query comments for query log correlation:

```rust
sqlx::query(&format!(
    "/* request_id: {} */ SELECT * FROM bounties WHERE id = $1",
    request_id
))
.bind(bounty_id)
.fetch_one(&pool)
.await?;
```

## Monitoring & Observability

### Metrics

Track request IDs in metrics for correlation:

```rust
metrics::counter!("api.requests", 1, "request_id" => request_id.clone());
```

### APM Integration

Most APM tools (DataDog, New Relic, etc.) can automatically extract and index the request_id field from structured logs.

### Log Aggregation

In production, use log aggregation tools (ELK, Splunk, CloudWatch) to:
- Search by request ID
- Create dashboards showing request flows
- Set up alerts for error patterns

## Best Practices

1. **Always propagate request IDs** when making downstream calls
2. **Include request ID in error responses** to help users report issues
3. **Use structured logging** (JSON) for easier parsing and searching
4. **Keep request IDs in response bodies** for API consumers
5. **Document the X-Request-ID header** in your API documentation

## Troubleshooting

### Request ID not appearing in logs

Ensure the middleware is registered before the Logger middleware:

```rust
.wrap(RequestId)  // Must come first
.wrap(middleware::Logger::default())
```

### Request ID not in response headers

Check that the middleware is wrapping the entire application, not just specific routes.

### Different request IDs in logs

This is expected if you're making multiple independent requests. Each request gets its own ID unless explicitly provided via header.

## Future Enhancements

- [ ] Add support for W3C Trace Context standard
- [ ] Implement request ID propagation in Redis operations
- [ ] Add correlation ID support for grouping related requests
- [ ] Create dashboard templates for common monitoring tools
- [ ] Add OpenTelemetry integration

## References

- [Actix-Web Middleware Documentation](https://actix.rs/docs/middleware/)
- [Tracing Crate](https://docs.rs/tracing/)
- [UUID Crate](https://docs.rs/uuid/)
- [W3C Trace Context](https://www.w3.org/TR/trace-context/)
