# Stellar Notifications Service

A Redis-based message queue service for reliable notification delivery. This service implements Issue #57 - Notifications Service - Missing Queue System.

## Features

- **Redis-based Message Queue**: Reliable, persistent queue for notification delivery
- **Multiple Notification Types**: Email, In-App, Push, Webhook, SMS
- **Priority-based Processing**: Critical, High, Normal, Low priority levels
- **Automatic Retries**: Exponential backoff with configurable max retries
- **Dead Letter Queue**: Failed notifications after max retries are stored for analysis
- **Background Workers**: Async processing of notifications
- **REST API**: HTTP endpoints for sending and managing notifications
- **Scheduled Notifications**: Schedule notifications for future delivery

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   HTTP API      │────▶│  Redis Queue     │────▶│  Worker Pool    │
│  (Actix-web)    │     │  (Sorted Sets)   │     │  (Background)   │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │                           │
                               ▼                           ▼
                        ┌──────────────┐          ┌─────────────────┐
                        │  Data Store  │          │  Email/SMS/Push │
                        │  (Redis)     │          │  Providers      │
                        └──────────────┘          └─────────────────┘
```

## Queue Structure

The service uses Redis sorted sets for different queues:

- `notifications:queue:pending` - Notifications waiting to be processed
- `notifications:queue:processing` - Currently being processed
- `notifications:queue:delivered` - Successfully delivered
- `notifications:queue:failed` - Failed but will be retried
- `notifications:queue:dead_letter` - Permanently failed

## API Endpoints

### Health Check
```
GET /health
```

### Send Notification
```
POST /notifications
Content-Type: application/json

{
  "notification_type": "email",
  "priority": "high",
  "payload": {
    "email": {
      "to": ["user@example.com"],
      "subject": "Welcome!",
      "body_text": "Welcome to Stellar!",
      "body_html": "<h1>Welcome!</h1>"
    }
  }
}
```

### Get Notification Status
```
GET /notifications/{id}/status
```

### Retry Failed Notification
```
POST /notifications/{id}/retry
```

### Bulk Send
```
POST /notifications/bulk
Content-Type: application/json

[
  { "notification_type": "email", ... },
  { "notification_type": "push", ... }
]
```

## Notification Types

### Email
```json
{
  "notification_type": "email",
  "payload": {
    "email": {
      "to": ["user@example.com"],
      "cc": ["cc@example.com"],
      "bcc": ["bcc@example.com"],
      "subject": "Subject",
      "body_text": "Plain text body",
      "body_html": "<p>HTML body</p>",
      "attachments": [
        {
          "filename": "file.pdf",
          "content_type": "application/pdf",
          "content": "base64encodedcontent"
        }
      ]
    }
  }
}
```

### In-App
```json
{
  "notification_type": "in_app",
  "payload": {
    "in_app": {
      "user_id": "user-123",
      "title": "New Message",
      "message": "You have a new message",
      "action_url": "/messages/123",
      "icon": "message-icon"
    }
  }
}
```

### Push
```json
{
  "notification_type": "push",
  "payload": {
    "push": {
      "device_tokens": ["token1", "token2"],
      "title": "Alert",
      "body": "Important notification",
      "data": { "key": "value" },
      "platform": "fcm"
    }
  }
}
```

### Webhook
```json
{
  "notification_type": "webhook",
  "payload": {
    "webhook": {
      "url": "https://api.example.com/webhook",
      "method": "POST",
      "headers": { "X-Custom": "header" },
      "body": { "event": "notification" },
      "timeout_seconds": 30
    }
  }
}
```

### SMS
```json
{
  "notification_type": "sms",
  "payload": {
    "sms": {
      "phone_numbers": ["+1234567890"],
      "message": "Your code is 123456",
      "sender_id": "STELLAR"
    }
  }
}
```

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `NOTIFICATIONS_HOST` | 0.0.0.0 | HTTP server host |
| `NOTIFICATIONS_PORT` | 3003 | HTTP server port |
| `REDIS_URL` | redis://localhost:6379 | Redis connection URL |
| `MAX_RETRIES` | 3 | Maximum retry attempts |
| `RETRY_DELAY_SECONDS` | 60 | Base delay between retries |
| `WORKER_POLL_INTERVAL_SECONDS` | 5 | Worker poll interval |
| `SMTP_HOST` | smtp.gmail.com | SMTP server host |
| `SMTP_PORT` | 587 | SMTP server port |
| `SMTP_USERNAME` | - | SMTP username |
| `SMTP_PASSWORD` | - | SMTP password |
| `SMTP_FROM_ADDRESS` | notifications@stellar.local | From email address |
| `SMTP_FROM_NAME` | Stellar Platform | From name |

## Running Locally

```bash
# Start dependencies
docker-compose up -d redis

# Run the service
cargo run --bin stellar-notifications
```

## Testing

```bash
# Health check
curl http://localhost:3003/health

# Send email notification
curl -X POST http://localhost:3003/notifications \
  -H "Content-Type: application/json" \
  -d '{
    "notification_type": "email",
    "priority": "normal",
    "payload": {
      "email": {
        "to": ["test@example.com"],
        "subject": "Test",
        "body_text": "Hello World"
      }
    }
  }'
```

## Retry Logic

The service implements exponential backoff for retries:

- Retry 1: 60 seconds
- Retry 2: 120 seconds
- Retry 3: 240 seconds

Notifications that fail after max retries are moved to the dead letter queue.

## Monitoring

Queue statistics can be retrieved via:
```
GET /queue/stats
```

Response:
```json
{
  "pending": 10,
  "processing": 2,
  "delivered": 150,
  "failed": 3,
  "dead_letter": 1
}
```

## Issue Resolution

This implementation resolves **Issue #57 - Notifications Service - Missing Queue System**:

- ✅ **Problem**: No message queue for reliable notification delivery
- ✅ **Solution**: Implemented Redis-based queue with sorted sets
- ✅ **Problem**: Notifications may be lost if service crashes during sending
- ✅ **Solution**: Notifications are persisted in Redis before processing; automatic retry on failure
- ✅ **Additional Features**: Priority-based processing, scheduled notifications, dead letter queue
