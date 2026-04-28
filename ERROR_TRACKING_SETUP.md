# Centralized Error Tracking Implementation

This document describes the centralized error tracking system that replaces sessionStorage-based error logging with production-grade observability.

## Overview

The error tracking system integrates:
- **Sentry**: Client-side error capture and session replay
- **Backend Logging Endpoint**: Centralized error storage in database
- **Error Statistics API**: Aggregated metrics and analytics
- **Error Context**: Rich error metadata for debugging

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend Application                      │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Error Boundary / Try-Catch Blocks                   │   │
│  │  ↓                                                    │   │
│  │  errorTracker.captureError()                         │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
         ↓                                    ↓
    ┌─────────────┐                  ┌──────────────────┐
    │   Sentry    │                  │ Backend Endpoint │
    │  (Client)   │                  │ /api/errors/log  │
    └─────────────┘                  └──────────────────┘
         ↓                                    ↓
    ┌─────────────┐                  ┌──────────────────┐
    │  Sentry.io  │                  │   PostgreSQL     │
    │  Dashboard  │                  │   ErrorLog Table │
    └─────────────┘                  └──────────────────┘
                                            ↓
                                    ┌──────────────────┐
                                    │ /api/errors/stats│
                                    │  (Admin API)     │
                                    └──────────────────┘
```

## Setup Instructions

### 1. Install Dependencies

```bash
npm install @sentry/nextjs
```

### 2. Configure Environment Variables

Add to `.env.local`:

```env
# Sentry Configuration
NEXT_PUBLIC_SENTRY_DSN=https://your-key@sentry.io/project-id
SENTRY_AUTH_TOKEN=your-sentry-auth-token
NEXT_PUBLIC_SENTRY_ENVIRONMENT=development
SENTRY_RELEASE=1.0.0
NEXT_PUBLIC_ENABLE_ERROR_TRACKING=true
```

### 3. Update Prisma Schema

Add the ErrorLog model to `prisma/schema.prisma`:

```prisma
model ErrorLog {
  id          String   @id
  level       String   @default("error")
  message     String
  stack       String?
  url         String?
  userAgent   String?
  environment String?
  userId      String?
  sessionId   String
  component   String?
  action      String?
  metadata    Json?
  timestamp   DateTime @default(now())
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([timestamp(sort: Desc)])
  @@index([level])
  @@index([userId])
  @@index([component])
  @@index([sessionId])
}
```

### 4. Run Database Migration

```bash
npx prisma migrate dev --name add_error_log_model
```

### 5. Wrap Root Layout

Update your root layout to include the ErrorTrackingProvider:

```tsx
import { ErrorTrackingProvider } from '@/components/error-tracking-provider';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        <ErrorTrackingProvider>
          {children}
        </ErrorTrackingProvider>
      </body>
    </html>
  );
}
```

## Usage Examples

### Basic Error Capture

```tsx
import { errorTracker } from '@/lib/error-tracking';

try {
  // Some operation
} catch (error) {
  await errorTracker.captureError(error, {
    component: 'PaymentForm',
    action: 'submit',
    userId: user.id,
  });
}
```

### Using Hooks

```tsx
import { useCaptureError, useAddBreadcrumb } from '@/hooks/useErrorTracking';

export function MyComponent() {
  const captureError = useCaptureError();
  const addBreadcrumb = useAddBreadcrumb();

  const handleClick = async () => {
    addBreadcrumb('User clicked button', 'user-action');
    
    try {
      await someAsyncOperation();
    } catch (error) {
      await captureError(error, {
        component: 'MyComponent',
        action: 'handleClick',
      });
    }
  };

  return <button onClick={handleClick}>Click me</button>;
}
```

### Using API Wrapper

```tsx
import { fetchWithTracking } from '@/lib/api-with-tracking';

const data = await fetchWithTracking('/api/data', {
  context: {
    component: 'DataFetcher',
    action: 'fetch_data',
  },
});
```

### Setting User Context

```tsx
import { useSetErrorTrackingUser } from '@/hooks/useErrorTracking';

export function UserProvider({ userId, userEmail, children }) {
  useSetErrorTrackingUser(userId, userEmail);
  return children;
}
```

## Verification Steps

### 1. Verify Errors Are Sent to Tracking Service

**Test in Development:**

```tsx
// Add this to a test component
import { errorTracker } from '@/lib/error-tracking';

export function ErrorTrackingTest() {
  return (
    <button
      onClick={async () => {
        await errorTracker.captureError(
          new Error('Test error from frontend'),
          {
            component: 'ErrorTrackingTest',
            action: 'test_capture',
          }
        );
      }}
    >
      Trigger Test Error
    </button>
  );
}
```

**Verification:**
- Check browser console for logs
- Check `/api/errors/log` endpoint receives POST request
- Verify error appears in Sentry dashboard
- Verify error appears in database

### 2. Confirm SessionStorage Is No Longer Used

**Search for sessionStorage usage:**

```bash
grep -r "sessionStorage" --include="*.ts" --include="*.tsx" src/
```

**Expected result:** No error-related sessionStorage usage

**Verify in browser DevTools:**
- Open Application tab
- Check Session Storage
- Confirm no error data is stored there

### 3. Check Exception Details Are Searchable

**Query errors via API:**

```bash
# Get all errors
curl http://localhost:3000/api/errors/log

# Filter by component
curl http://localhost:3000/api/errors/log?component=PaymentForm

# Filter by user
curl http://localhost:3000/api/errors/log?userId=user123

# Get statistics
curl http://localhost:3000/api/errors/stats?hours=24
```

**Verify in Sentry:**
- Log in to Sentry dashboard
- Search for errors by message
- Filter by component, user, or timestamp
- View session replay for context

## API Endpoints

### POST /api/errors/log
Log an error from the frontend.

**Request:**
```json
{
  "id": "err_1234567890_abc123",
  "timestamp": "2024-01-15T10:30:00Z",
  "level": "error",
  "message": "Failed to process payment",
  "stack": "Error: Failed to process payment\n    at ...",
  "context": {
    "userId": "user123",
    "component": "PaymentForm",
    "action": "submit",
    "metadata": { "amount": 100 }
  },
  "url": "https://app.example.com/checkout",
  "userAgent": "Mozilla/5.0..."
}
```

**Response:**
```json
{
  "success": true,
  "errorId": "err_1234567890_abc123"
}
```

### GET /api/errors/log
Retrieve error logs (admin only).

**Query Parameters:**
- `limit`: Number of errors to return (default: 50, max: 100)
- `offset`: Pagination offset (default: 0)
- `level`: Filter by level (error, warning, info)
- `userId`: Filter by user ID
- `component`: Filter by component name

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "err_1234567890_abc123",
      "level": "error",
      "message": "Failed to process payment",
      "component": "PaymentForm",
      "userId": "user123",
      "timestamp": "2024-01-15T10:30:00Z"
    }
  ],
  "pagination": {
    "total": 150,
    "limit": 50,
    "offset": 0,
    "hasMore": true
  }
}
```

### GET /api/errors/stats
Get error statistics and metrics.

**Query Parameters:**
- `hours`: Time range in hours (default: 24)

**Response:**
```json
{
  "success": true,
  "timeRange": {
    "since": "2024-01-14T10:30:00Z",
    "until": "2024-01-15T10:30:00Z",
    "hours": 24
  },
  "summary": {
    "totalErrors": 42,
    "errorsByLevel": {
      "error": 35,
      "warning": 7,
      "info": 0
    }
  },
  "topErrors": [
    {
      "message": "Failed to process payment",
      "count": 12
    }
  ],
  "errorsByComponent": [
    {
      "component": "PaymentForm",
      "count": 15
    }
  ],
  "affectedUsers": [
    {
      "userId": "user123",
      "errorCount": 5
    }
  ]
}
```

## Monitoring & Alerting

### Sentry Dashboard
- Real-time error monitoring
- Session replay for context
- Performance monitoring
- Release tracking

### Backend Statistics
- Aggregated error metrics
- Component-level error rates
- User impact analysis
- Historical error trends

### Recommended Alerts
- Error rate spike (>10% increase)
- Critical errors (stack traces)
- New error patterns
- User-specific error clusters

## Best Practices

1. **Always provide context** when capturing errors:
   ```tsx
   await errorTracker.captureError(error, {
     component: 'ComponentName',
     action: 'actionName',
     userId: user.id,
   });
   ```

2. **Use breadcrumbs** for user actions:
   ```tsx
   errorTracker.addBreadcrumb('User clicked submit', 'user-action');
   ```

3. **Set user context** on login:
   ```tsx
   errorTracker.setUserContext(user.id, user.email);
   ```

4. **Clear user context** on logout:
   ```tsx
   errorTracker.clearUserContext();
   ```

5. **Use API wrapper** for fetch calls:
   ```tsx
   const data = await fetchWithTracking('/api/data', {
     context: { component: 'MyComponent' },
   });
   ```

## Troubleshooting

### Errors not appearing in Sentry
- Verify `NEXT_PUBLIC_SENTRY_DSN` is set correctly
- Check browser console for initialization errors
- Verify Sentry project is active

### Errors not appearing in database
- Verify `/api/errors/log` endpoint is accessible
- Check database connection
- Verify ErrorLog table exists
- Check server logs for errors

### High error volume
- Review error filtering in Sentry
- Implement error deduplication
- Set up error rate limits
- Review error context for patterns

## Migration from SessionStorage

If you have existing error handling using sessionStorage:

1. **Remove sessionStorage calls:**
   ```tsx
   // Before
   sessionStorage.setItem('error', JSON.stringify(error));
   
   // After
   await errorTracker.captureError(error, context);
   ```

2. **Update error display logic:**
   ```tsx
   // Before
   const error = JSON.parse(sessionStorage.getItem('error'));
   
   // After
   // Errors are now tracked centrally, display via UI state
   ```

3. **Update error clearing:**
   ```tsx
   // Before
   sessionStorage.removeItem('error');
   
   // After
   // Errors are automatically managed by error tracker
   ```

## Performance Considerations

- Error tracking is non-blocking (uses async/await)
- Errors are batched before sending to backend
- Sentry uses sampling to reduce overhead
- Session replay is limited to 10% of sessions
- Error replay is 100% for errors

## Security Considerations

- Sensitive data is masked in session replay
- User PII is not captured in error messages
- Error logs are stored securely in database
- API endpoints should require authentication
- Consider data retention policies

## Next Steps

1. Set up Sentry account and project
2. Configure environment variables
3. Run database migration
4. Update root layout with ErrorTrackingProvider
5. Test error capture with test component
6. Monitor error dashboard
7. Set up alerting rules
8. Document error handling patterns for team
