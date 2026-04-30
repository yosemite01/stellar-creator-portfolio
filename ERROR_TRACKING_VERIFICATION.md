# Error Tracking Implementation Verification Checklist

This document provides step-by-step verification that the centralized error tracking system is working correctly.

## Pre-Implementation Checklist

- [ ] Review ERROR_TRACKING_SETUP.md for complete setup instructions
- [ ] Ensure Node.js and npm are up to date
- [ ] Have Sentry account and project ready
- [ ] Have database access for migrations

## Installation & Configuration

### Step 1: Install Dependencies
```bash
npm install @sentry/nextjs
```
- [ ] Installation completed without errors
- [ ] `@sentry/nextjs` appears in package.json

### Step 2: Configure Environment Variables
```bash
# Copy .env.example to .env.local and update:
NEXT_PUBLIC_SENTRY_DSN=https://your-key@sentry.io/project-id
SENTRY_AUTH_TOKEN=your-sentry-auth-token
NEXT_PUBLIC_SENTRY_ENVIRONMENT=development
SENTRY_RELEASE=1.0.0
NEXT_PUBLIC_ENABLE_ERROR_TRACKING=true
```
- [ ] `.env.local` created with Sentry configuration
- [ ] `NEXT_PUBLIC_SENTRY_DSN` is valid
- [ ] `NEXT_PUBLIC_ENABLE_ERROR_TRACKING` is set to `true`

### Step 3: Database Migration
```bash
npx prisma migrate dev --name add_error_log_model
```
- [ ] Migration completed successfully
- [ ] `ErrorLog` table created in database
- [ ] Indexes created for performance

### Step 4: Update Root Layout
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
- [ ] ErrorTrackingProvider imported
- [ ] ErrorTrackingProvider wraps children
- [ ] App builds without errors

## Verification Step 1: Errors Are Sent to Tracking Service

### 1.1 Test Error Capture in Development

Create a test component:
```tsx
// components/error-tracking-test.tsx
'use client';

import { errorTracker } from '@/lib/error-tracking';

export function ErrorTrackingTest() {
  return (
    <div className="p-4 space-y-2">
      <button
        onClick={async () => {
          await errorTracker.captureError(
            new Error('Test error from frontend'),
            {
              component: 'ErrorTrackingTest',
              action: 'test_capture',
            }
          );
          alert('Error captured! Check console and Sentry');
        }}
        className="px-4 py-2 bg-red-500 text-white rounded"
      >
        Trigger Test Error
      </button>
    </div>
  );
}
```

Add to a page and test:
- [ ] Click "Trigger Test Error" button
- [ ] Check browser console for logs
- [ ] Verify no errors in console
- [ ] Wait 5-10 seconds for async operations

### 1.2 Verify Backend Endpoint Receives Error

**Check Network Tab:**
1. Open DevTools → Network tab
2. Click "Trigger Test Error"
3. Look for POST request to `/api/errors/log`
- [ ] POST request to `/api/errors/log` appears
- [ ] Request status is 201 (Created)
- [ ] Response contains `errorId`

**Check Response:**
```json
{
  "success": true,
  "errorId": "err_1234567890_abc123"
}
```
- [ ] Response has `success: true`
- [ ] Response has `errorId` field

### 1.3 Verify Error in Database

```bash
# Connect to database
psql $DATABASE_URL

# Query error logs
SELECT id, level, message, component, timestamp FROM "ErrorLog" 
ORDER BY timestamp DESC LIMIT 5;
```
- [ ] Error appears in ErrorLog table
- [ ] Message matches test error
- [ ] Component is "ErrorTrackingTest"
- [ ] Timestamp is recent

### 1.4 Verify Error in Sentry

1. Log in to Sentry dashboard
2. Navigate to your project
3. Look for recent errors
- [ ] Test error appears in Sentry
- [ ] Error message is visible
- [ ] Component tag shows "ErrorTrackingTest"
- [ ] User context is available (if set)

## Verification Step 2: SessionStorage Is No Longer Used

### 2.1 Search for SessionStorage Usage

```bash
# Search for sessionStorage in codebase
grep -r "sessionStorage" --include="*.ts" --include="*.tsx" .
```
- [ ] No error-related sessionStorage usage found
- [ ] Only non-error sessionStorage usage remains (if any)

### 2.2 Verify in Browser DevTools

1. Open DevTools → Application tab
2. Expand "Session Storage"
3. Check each domain
- [ ] No error data in Session Storage
- [ ] No `error` key in Session Storage
- [ ] No `errorLog` key in Session Storage

### 2.3 Verify Error Display Logic

Search for error display patterns:
```bash
grep -r "sessionStorage.getItem.*error" --include="*.ts" --include="*.tsx" .
```
- [ ] No results found
- [ ] Error display uses state/props instead

## Verification Step 3: Exception Details Are Searchable

### 3.1 Query Errors via Backend API

**Get all errors:**
```bash
curl http://localhost:3000/api/errors/log
```
- [ ] Returns 200 status
- [ ] Response contains error array
- [ ] Each error has id, message, timestamp

**Filter by component:**
```bash
curl "http://localhost:3000/api/errors/log?component=ErrorTrackingTest"
```
- [ ] Returns filtered results
- [ ] Only errors from specified component

**Filter by level:**
```bash
curl "http://localhost:3000/api/errors/log?level=error"
```
- [ ] Returns only error-level logs
- [ ] Excludes warnings and info

### 3.2 Query Error Statistics

```bash
curl http://localhost:3000/api/errors/stats?hours=24
```
- [ ] Returns 200 status
- [ ] Contains summary with error counts
- [ ] Contains topErrors array
- [ ] Contains errorsByComponent array
- [ ] Contains affectedUsers array

**Response should include:**
```json
{
  "success": true,
  "summary": {
    "totalErrors": 1,
    "errorsByLevel": {
      "error": 1,
      "warning": 0,
      "info": 0
    }
  },
  "topErrors": [
    {
      "message": "Test error from frontend",
      "count": 1
    }
  ]
}
```
- [ ] Summary shows correct error count
- [ ] Top errors list is populated
- [ ] Statistics are accurate

### 3.3 Search in Sentry Dashboard

1. Log in to Sentry
2. Go to Issues page
3. Use search/filter features
- [ ] Can search by error message
- [ ] Can filter by component tag
- [ ] Can filter by user
- [ ] Can filter by timestamp
- [ ] Results are accurate

### 3.4 Database Query Verification

```bash
# Search by message
SELECT * FROM "ErrorLog" WHERE message LIKE '%Test error%';

# Search by component
SELECT * FROM "ErrorLog" WHERE component = 'ErrorTrackingTest';

# Search by user
SELECT * FROM "ErrorLog" WHERE "userId" = 'user123';

# Get error statistics
SELECT level, COUNT(*) as count FROM "ErrorLog" 
GROUP BY level;
```
- [ ] All queries return expected results
- [ ] Indexes are being used (check EXPLAIN)
- [ ] Query performance is acceptable

## Verification Step 4: Error Context & Metadata

### 4.1 Test Error with Full Context

```tsx
await errorTracker.captureError(
  new Error('Payment processing failed'),
  {
    userId: 'user123',
    userEmail: 'user@example.com',
    component: 'PaymentForm',
    action: 'submit',
    metadata: {
      amount: 100,
      currency: 'USD',
      paymentMethod: 'card',
    },
  }
);
```

**Verify in database:**
```bash
SELECT id, message, "userId", component, action, metadata 
FROM "ErrorLog" 
WHERE message LIKE '%Payment%';
```
- [ ] userId is stored correctly
- [ ] component is stored correctly
- [ ] action is stored correctly
- [ ] metadata JSON is stored correctly

**Verify in Sentry:**
- [ ] User context shows user123
- [ ] Tags show component and action
- [ ] Custom context shows metadata

### 4.2 Test Breadcrumbs

```tsx
import { errorTracker } from '@/lib/error-tracking';

errorTracker.addBreadcrumb('User clicked submit', 'user-action');
errorTracker.addBreadcrumb('Form validation started', 'validation');
errorTracker.addBreadcrumb('API call initiated', 'api');

// Then trigger error
await errorTracker.captureError(new Error('API failed'), {
  component: 'PaymentForm',
});
```

**Verify in Sentry:**
1. Open the error in Sentry
2. Look for Breadcrumbs section
- [ ] Breadcrumbs appear in order
- [ ] Each breadcrumb has correct message
- [ ] Each breadcrumb has correct category
- [ ] Timestamps are accurate

## Verification Step 5: Integration Tests

### 5.1 Run Error Tracking Tests

```bash
npm run test -- error-tracking.test.ts
```
- [ ] All tests pass
- [ ] No test failures
- [ ] Coverage is adequate

### 5.2 Test Error Boundary Integration

Create a test component that throws:
```tsx
export function ErrorBoundaryTest() {
  throw new Error('Test error from component');
}
```

Wrap in error boundary and verify:
- [ ] Error is caught by boundary
- [ ] Error is sent to tracking service
- [ ] Error appears in Sentry
- [ ] Error appears in database

### 5.3 Test API Error Handling

```tsx
import { handleApiResponse } from '@/lib/error-handling';

const response = {
  success: false,
  error: {
    code: 'VALIDATION_ERROR',
    message: 'Invalid input',
    fieldErrors: [{ field: 'email', message: 'Invalid email' }],
  },
};

try {
  handleApiResponse(response, {
    component: 'TestForm',
    action: 'submit',
  });
} catch (error) {
  // Error should be tracked
}
```

Verify:
- [ ] Error is thrown
- [ ] Error is sent to tracking service
- [ ] Error appears in Sentry
- [ ] Error appears in database

## Verification Step 6: Production Readiness

### 6.1 Performance Check

- [ ] Error tracking doesn't block UI
- [ ] Error capture is non-blocking
- [ ] No memory leaks from error tracking
- [ ] Session ID is consistent across session

### 6.2 Security Check

- [ ] Sensitive data is not logged
- [ ] PII is masked in session replay
- [ ] API endpoints require authentication
- [ ] Error logs are stored securely

### 6.3 Error Rate Monitoring

```bash
# Check error rate over time
SELECT DATE_TRUNC('hour', timestamp) as hour, COUNT(*) as count
FROM "ErrorLog"
GROUP BY hour
ORDER BY hour DESC
LIMIT 24;
```
- [ ] Error rate is reasonable
- [ ] No error spikes
- [ ] Trends are visible

### 6.4 Data Retention

- [ ] Error logs are retained appropriately
- [ ] Old errors can be archived
- [ ] Database size is manageable
- [ ] Queries remain performant

## Verification Step 7: Team Readiness

### 7.1 Documentation

- [ ] ERROR_TRACKING_SETUP.md is complete
- [ ] API endpoints are documented
- [ ] Usage examples are provided
- [ ] Troubleshooting guide is available

### 7.2 Team Training

- [ ] Team understands error tracking system
- [ ] Team knows how to use errorTracker
- [ ] Team knows how to access Sentry
- [ ] Team knows how to query error logs

### 7.3 Monitoring Setup

- [ ] Sentry alerts are configured
- [ ] Error rate thresholds are set
- [ ] Critical error notifications are enabled
- [ ] Team is notified of alerts

## Final Verification Checklist

- [ ] All 7 verification steps completed
- [ ] No errors in production logs
- [ ] Error tracking is working in development
- [ ] Error tracking is working in staging
- [ ] Team is trained and ready
- [ ] Documentation is complete
- [ ] Monitoring is configured
- [ ] Alerting is configured

## Rollback Plan

If issues occur:

1. **Disable error tracking:**
   ```bash
   NEXT_PUBLIC_ENABLE_ERROR_TRACKING=false
   ```

2. **Revert database migration:**
   ```bash
   npx prisma migrate resolve --rolled-back add_error_log_model
   ```

3. **Remove ErrorTrackingProvider:**
   ```tsx
   // Remove from root layout
   ```

4. **Uninstall Sentry:**
   ```bash
   npm uninstall @sentry/nextjs
   ```

## Success Criteria

✅ **All of the following must be true:**

1. Errors are captured and sent to Sentry
2. Errors are stored in database
3. Errors are queryable via API
4. SessionStorage is not used for errors
5. Error details are searchable
6. Performance is acceptable
7. Security is maintained
8. Team is trained
9. Monitoring is configured
10. Documentation is complete

## Sign-Off

- [ ] Development Lead: _________________ Date: _______
- [ ] QA Lead: _________________ Date: _______
- [ ] DevOps Lead: _________________ Date: _______
- [ ] Product Manager: _________________ Date: _______

---

**Last Updated:** 2024-01-15
**Version:** 1.0.0
**Status:** Ready for Implementation
