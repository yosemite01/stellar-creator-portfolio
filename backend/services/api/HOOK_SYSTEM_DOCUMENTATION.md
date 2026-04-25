# Review Submission Hook System Documentation

## Overview

The Stellar Creator Portfolio API includes a comprehensive hook system that triggers when reviews are submitted. This system enables real-time reputation updates, analytics tracking, notifications, and other automated processes.

## Architecture

### Hook Registration

The system uses a global registry pattern where hooks are registered at application startup and triggered when review submission events occur.

```rust
// Register a hook
register_review_submitted_hook(|event| {
    // Your hook logic here
    println!("Review {} submitted for creator {}", event.review_id, event.creator_id);
    Ok(())
});
```

### Event Flow

1. **Review Submission** → `POST /api/v1/reviews`
2. **Validation** → Field validation and business rules
3. **Hook Trigger** → `on_review_submitted()` function
4. **Event Creation** → `ReviewSubmittedEvent` struct
5. **Hook Execution** → All registered hooks are called
6. **Response** → Success/failure response to client

## Core Components

### ReviewSubmittedEvent

The event data structure passed to all hooks:

```rust
pub struct ReviewSubmittedEvent {
    pub review_id: String,        // Unique review identifier
    pub creator_id: String,       // Creator being reviewed
    pub rating: u8,              // Rating (1-5)
    pub title: String,           // Review title
    pub body: String,            // Review content
    pub reviewer_name: String,   // Name of reviewer
    pub bounty_id: String,       // Associated bounty
    pub submitted_at: String,    // ISO timestamp
}
```

### Hook Function Type

```rust
pub type ReviewSubmittedHook = Arc<dyn Fn(&ReviewSubmittedEvent) -> Result<(), String> + Send + Sync>;
```

Hooks must:
- Accept a `&ReviewSubmittedEvent` parameter
- Return `Result<(), String>` (Ok for success, Err with message for failure)
- Be thread-safe (`Send + Sync`)

## Default Hooks

The system includes several built-in hooks:

### 1. Reputation Update Hook

Updates creator's aggregated reputation data:

```rust
pub fn default_reputation_update_hook(event: &ReviewSubmittedEvent) -> Result<(), String> {
    // Updates:
    // - Average rating calculation
    // - Review count totals
    // - Star distribution histogram
    // - Verification status
    // - Cache invalidation
}
```

### 2. Analytics Hook

Tracks review submission metrics:

```rust
register_review_submitted_hook(|event| {
    tracing::info!("Analytics: Review {} submitted for creator {}", 
        event.review_id, event.creator_id);
    // In production: send to analytics service
    Ok(())
});
```

### 3. Notification Hook

Sends notifications for positive reviews:

```rust
register_review_submitted_hook(|event| {
    if event.rating >= 4 {
        tracing::info!("Notification: Positive review for creator {}", 
            event.creator_id);
        // In production: send email/push notification
    }
    Ok(())
});
```

## API Integration

### Review Submission Endpoint

```http
POST /api/v1/reviews
Content-Type: application/json

{
  "bountyId": "bounty-123",
  "creatorId": "creator-456", 
  "rating": 5,
  "title": "Excellent work",
  "body": "Outstanding delivery and communication",
  "reviewerName": "John Doe"
}
```

### Success Response

```json
{
  "success": true,
  "data": {
    "reviewId": "rev-creator-456-bounty-123-1704067200000",
    "creatorId": "creator-456",
    "status": "submitted"
  },
  "message": "Review submitted successfully"
}
```

### Error Response

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Review submission failed",
    "fieldErrors": [
      {
        "field": "rating",
        "message": "Rating must be between 1 and 5"
      }
    ]
  }
}
```

## Validation Rules

The system enforces strict validation:

| Field | Rules |
|-------|-------|
| `bountyId` | Required, non-empty string |
| `creatorId` | Required, non-empty string |
| `rating` | Required, integer 1-5 |
| `title` | Required, non-empty string |
| `body` | Required, non-empty string |
| `reviewerName` | Required, non-empty string |

## Error Handling

### Hook Failures

- Individual hook failures don't prevent review submission
- Errors are logged but don't affect the API response
- Failed hooks are tracked for monitoring

### Validation Failures

- Stop processing immediately
- Return detailed field-level errors
- No hooks are triggered for invalid submissions

## Production Considerations

### Database Integration

In production, replace the in-memory store with database operations:

```rust
fn add_review_to_store(event: &ReviewSubmittedEvent) {
    // Insert into reviews table
    // Update creator reputation aggregates
    // Invalidate caches
}
```

### Async Hook Execution

For performance, consider async hook execution:

```rust
// Future enhancement: async hooks
pub type AsyncReviewSubmittedHook = Arc<dyn Fn(&ReviewSubmittedEvent) -> BoxFuture<'static, Result<(), String>> + Send + Sync>;
```

### Hook Ordering

Currently hooks execute in registration order. For production:

```rust
pub struct HookRegistration {
    pub priority: u8,
    pub name: String,
    pub hook: ReviewSubmittedHook,
}
```

### Monitoring & Observability

Add metrics for hook performance:

```rust
register_review_submitted_hook(|event| {
    let start = std::time::Instant::now();
    // Hook logic
    let duration = start.elapsed();
    metrics::histogram!("hook_execution_time", duration);
    Ok(())
});
```

## Testing

### Unit Tests

The system includes comprehensive tests:

- Hook registration and execution
- Event validation
- Error handling
- Boundary conditions
- Integration scenarios

### Test Examples

```rust
#[test]
fn test_hook_execution() {
    let counter = Arc::new(Mutex::new(0));
    let counter_clone = counter.clone();
    
    register_review_submitted_hook(move |_| {
        *counter_clone.lock().unwrap() += 1;
        Ok(())
    });
    
    let event = ReviewSubmittedEvent { /* ... */ };
    trigger_review_submitted_hooks(&event);
    
    assert_eq!(*counter.lock().unwrap(), 1);
}
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `HOOK_TIMEOUT_MS` | Hook execution timeout | 5000 |
| `MAX_HOOK_RETRIES` | Retry attempts for failed hooks | 3 |
| `ENABLE_ASYNC_HOOKS` | Enable async hook execution | false |

### Feature Flags

```rust
pub struct HookConfig {
    pub enable_reputation_updates: bool,
    pub enable_notifications: bool,
    pub enable_analytics: bool,
    pub max_concurrent_hooks: usize,
}
```

## Security Considerations

### Input Sanitization

All review content is validated and sanitized:

```rust
fn sanitize_review_content(content: &str) -> String {
    // Remove potentially harmful content
    // Validate length limits
    // Escape special characters
}
```

### Rate Limiting

Implement rate limiting for review submissions:

```rust
// Per-user rate limiting
const MAX_REVIEWS_PER_HOUR: u32 = 10;
```

### Authentication

Review submissions require valid authentication:

```rust
// Verify reviewer has completed the bounty
// Check for duplicate reviews
// Validate reviewer permissions
```

## Future Enhancements

### Planned Features

1. **Webhook Support** - External HTTP callbacks
2. **Event Sourcing** - Complete audit trail
3. **Hook Marketplace** - Plugin system for custom hooks
4. **Real-time Updates** - WebSocket notifications
5. **ML Integration** - Sentiment analysis and fraud detection

### API Extensions

```rust
// Future: Custom hook registration via API
POST /api/v1/hooks/register
{
  "name": "custom-analytics",
  "url": "https://analytics.example.com/webhook",
  "events": ["review_submitted", "reputation_updated"]
}
```

## Troubleshooting

### Common Issues

1. **Hook Not Executing**
   - Check registration order
   - Verify hook function signature
   - Review error logs

2. **Performance Issues**
   - Monitor hook execution times
   - Consider async execution
   - Implement hook timeouts

3. **Memory Leaks**
   - Avoid capturing large objects in closures
   - Use weak references where appropriate
   - Monitor hook registry size

### Debug Mode

Enable detailed logging:

```rust
RUST_LOG=stellar_api=debug cargo run
```

### Health Checks

Monitor hook system health:

```rust
GET /api/v1/hooks/health
{
  "registered_hooks": 3,
  "total_executions": 1247,
  "failed_executions": 2,
  "average_execution_time_ms": 15.3
}
```

## Conclusion

The review submission hook system provides a robust, extensible foundation for handling review-related events in the Stellar Creator Portfolio platform. It enables real-time reputation updates, comprehensive analytics, and seamless integration with external services while maintaining high performance and reliability.