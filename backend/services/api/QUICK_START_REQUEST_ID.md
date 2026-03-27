# Quick Start: Request ID Tracing

## What's New?

Every API request now has a unique identifier that appears in:
- Response headers (`X-Request-ID`)
- All log entries
- Request context

## For API Consumers

### Send a Request

```bash
curl http://localhost:3001/health
```

### Response Includes Request ID

```json
{
  "status": "healthy",
  "service": "stellar-api",
  "version": "0.1.0",
  "request_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

Response headers:
```
X-Request-ID: 550e8400-e29b-41d4-a716-446655440000
```

### Provide Your Own Request ID

```bash
curl -H "X-Request-ID: my-trace-123" http://localhost:3001/health
```

The same ID will be returned in the response.

## For Developers

### Access Request ID in Handlers

```rust
use actix_web::{HttpRequest, HttpResponse};
use crate::middleware::get_request_id;

async fn my_handler(req: HttpRequest) -> HttpResponse {
    let request_id = get_request_id(&req).unwrap_or_default();
    
    tracing::info!(request_id = %request_id, "Processing");
    
    HttpResponse::Ok().finish()
}
```

### Logs Automatically Include Request ID

```rust
// This log entry will include the request_id field
tracing::info!("User created bounty");

// Output:
// INFO request{request_id=550e8400-e29b-41d4-a716-446655440000 method=POST path=/api/bounties}: User created bounty
```

### Search Logs by Request ID

```bash
# Find all logs for a specific request
grep "request_id=550e8400-e29b-41d4-a716-446655440000" logs/api.log
```

## Common Use Cases

### 1. Debug User Issues

User reports an error → Get request ID from response → Search logs:

```bash
grep "request_id=abc-123" logs/*.log
```

### 2. Trace Distributed Requests

Pass the same request ID when calling other services:

```rust
let client = reqwest::Client::new();
client.get("http://other-service/api")
    .header("X-Request-ID", request_id)
    .send()
    .await?;
```

### 3. Performance Analysis

Track slow requests by request ID:

```rust
let start = std::time::Instant::now();
// ... process request ...
tracing::info!(
    request_id = %request_id,
    duration_ms = %start.elapsed().as_millis(),
    "Request completed"
);
```

## Testing

```bash
# Run middleware tests
cargo test request_id

# Test with curl
curl -v http://localhost:3001/health | grep -i x-request-id
```

## Configuration

No configuration needed! The middleware is automatically enabled.

To customize logging:

```bash
# Set log level
export RUST_LOG=info,stellar_api=debug

# Run the service
cargo run --bin stellar-api
```

## Need Help?

See [REQUEST_ID_IMPLEMENTATION.md](./REQUEST_ID_IMPLEMENTATION.md) for detailed documentation.
