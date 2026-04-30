# Error Tracking Migration Guide

Guide for migrating existing error handling code to use the new centralized error tracking system.

## Overview

This guide helps you migrate from:
- ❌ sessionStorage-based error logging
- ❌ console.error() only
- ❌ Scattered error handling

To:
- ✅ Centralized error tracking
- ✅ Sentry integration
- ✅ Database persistence
- ✅ Rich error context

## Migration Patterns

### Pattern 1: Try-Catch Blocks

**Before:**
```tsx
try {
  await someOperation();
} catch (error) {
  console.error('Operation failed:', error);
  sessionStorage.setItem('error', JSON.stringify(error));
}
```

**After:**
```tsx
import { errorTracker } from '@/lib/error-tracking';

try {
  await someOperation();
} catch (error) {
  await errorTracker.captureError(error, {
    component: 'MyComponent',
    action: 'someOperation',
  });
}
```

### Pattern 2: Error Boundaries

**Before:**
```tsx
componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
  console.error('ErrorBoundary caught:', error, errorInfo);
  sessionStorage.setItem('error', JSON.stringify(error));
}
```

**After:**
```tsx
import { errorTracker } from '@/lib/error-tracking';

componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
  void errorTracker.captureError(error, {
    component: 'ErrorBoundary',
    metadata: errorInfo,
  });
}
```

### Pattern 3: API Error Handling

**Before:**
```tsx
try {
  const response = await fetch('/api/data');
  if (!response.ok) {
    console.error('API error:', response.status);
    sessionStorage.setItem('apiError', response.statusText);
  }
  return await response.json();
} catch (error) {
  console.error('Fetch failed:', error);
}
```

**After:**
```tsx
import { fetchWithTracking } from '@/lib/api-with-tracking';

const data = await fetchWithTracking('/api/data', {
  context: {
    component: 'MyComponent',
    action: 'fetchData',
  },
});
```

### Pattern 4: Form Submission

**Before:**
```tsx
const handleSubmit = async (data) => {
  try {
    const response = await fetch('/api/submit', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response.json();
      console.error('Submission failed:', error);
      sessionStorage.setItem('formError', JSON.stringify(error));
      setError(error.message);
    }
  } catch (error) {
    console.error('Submit error:', error);
    setError('An error occurred');
  }
};
```

**After:**
```tsx
import { errorTracker } from '@/lib/error-tracking';
import { fetchWithTracking } from '@/lib/api-with-tracking';

const handleSubmit = async (data) => {
  try {
    const response = await fetchWithTracking('/api/submit', {
      method: 'POST',
      body: JSON.stringify(data),
      context: {
        component: 'MyForm',
        action: 'submit',
        metadata: { formName: 'contactForm' },
      },
    });
    // Handle success
  } catch (error) {
    await errorTracker.captureError(error, {
      component: 'MyForm',
      action: 'submit',
      metadata: { formName: 'contactForm' },
    });
    setError(error.message);
  }
};
```

### Pattern 5: React Hooks

**Before:**
```tsx
useEffect(() => {
  const fetchData = async () => {
    try {
      const response = await fetch('/api/data');
      const data = await response.json();
      setData(data);
    } catch (error) {
      console.error('Fetch failed:', error);
      setError('Failed to load data');
    }
  };
  fetchData();
}, []);
```

**After:**
```tsx
import { useCaptureError } from '@/hooks/useErrorTracking';

useEffect(() => {
  const captureError = useCaptureError();
  
  const fetchData = async () => {
    try {
      const response = await fetch('/api/data');
      const data = await response.json();
      setData(data);
    } catch (error) {
      await captureError(error, {
        component: 'DataFetcher',
        action: 'fetchData',
      });
      setError('Failed to load data');
    }
  };
  fetchData();
}, []);
```

### Pattern 6: Async Operations

**Before:**
```tsx
const processPayment = async (amount) => {
  try {
    const result = await stripeClient.confirmPayment({
      elements,
      confirmParams: { return_url: window.location.href },
    });
    if (result.error) {
      console.error('Payment failed:', result.error);
      sessionStorage.setItem('paymentError', JSON.stringify(result.error));
    }
  } catch (error) {
    console.error('Payment error:', error);
  }
};
```

**After:**
```tsx
import { errorTracker } from '@/lib/error-tracking';
import { withErrorTracking } from '@/lib/api-with-tracking';

const processPayment = async (amount) => {
  return withErrorTracking(
    async () => {
      const result = await stripeClient.confirmPayment({
        elements,
        confirmParams: { return_url: window.location.href },
      });
      if (result.error) {
        throw new Error(result.error.message);
      }
      return result;
    },
    {
      component: 'PaymentForm',
      action: 'processPayment',
      metadata: { amount },
    }
  );
};
```

### Pattern 7: Error Display

**Before:**
```tsx
useEffect(() => {
  const error = sessionStorage.getItem('error');
  if (error) {
    setError(JSON.parse(error));
    sessionStorage.removeItem('error');
  }
}, []);

return (
  <div>
    {error && <ErrorAlert message={error.message} />}
  </div>
);
```

**After:**
```tsx
// Errors are automatically tracked
// Display errors via component state or toast notifications

const [error, setError] = useState<string | null>(null);

const handleOperation = async () => {
  try {
    await someOperation();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An error occurred';
    setError(message);
    // Error is automatically tracked
  }
};

return (
  <div>
    {error && <ErrorAlert message={error} />}
  </div>
);
```

## Step-by-Step Migration

### Step 1: Identify Error Handling Code

Search for error handling patterns:
```bash
grep -r "console.error" --include="*.ts" --include="*.tsx" src/
grep -r "sessionStorage" --include="*.ts" --include="*.tsx" src/
grep -r "catch.*error" --include="*.ts" --include="*.tsx" src/
```

### Step 2: Update Imports

Add error tracking imports to files:
```tsx
import { errorTracker } from '@/lib/error-tracking';
import { fetchWithTracking } from '@/lib/api-with-tracking';
import { useCaptureError, useAddBreadcrumb } from '@/hooks/useErrorTracking';
```

### Step 3: Replace Error Handling

Replace each error handling pattern with the new approach:

1. Replace `console.error()` with `errorTracker.captureError()`
2. Replace `sessionStorage` with error tracking
3. Replace `fetch()` with `fetchWithTracking()`
4. Add context to all error captures

### Step 4: Add Breadcrumbs

Add breadcrumbs for important user actions:
```tsx
import { useAddBreadcrumb } from '@/hooks/useErrorTracking';

const addBreadcrumb = useAddBreadcrumb();

const handleClick = () => {
  addBreadcrumb('User clicked submit button', 'user-action');
  // ... rest of handler
};
```

### Step 5: Test

Test each migrated component:
1. Trigger errors intentionally
2. Verify errors appear in Sentry
3. Verify errors appear in database
4. Verify error context is correct

### Step 6: Remove Old Code

Remove old error handling code:
```bash
# Remove sessionStorage usage
grep -r "sessionStorage" --include="*.ts" --include="*.tsx" src/ | grep -i error

# Remove console.error calls (keep non-error logs)
grep -r "console.error" --include="*.ts" --include="*.tsx" src/
```

## Migration Checklist

### Phase 1: Setup (1-2 hours)
- [ ] Install @sentry/nextjs
- [ ] Configure environment variables
- [ ] Run database migration
- [ ] Update root layout with ErrorTrackingProvider
- [ ] Verify error tracking works

### Phase 2: Core Components (2-4 hours)
- [ ] Migrate error boundaries
- [ ] Migrate API error handling
- [ ] Migrate form submission handlers
- [ ] Migrate async operations
- [ ] Test each component

### Phase 3: Hooks & Utilities (1-2 hours)
- [ ] Migrate custom hooks
- [ ] Migrate utility functions
- [ ] Migrate service layer
- [ ] Test integrations

### Phase 4: Cleanup (1 hour)
- [ ] Remove sessionStorage usage
- [ ] Remove old error handling code
- [ ] Update error display logic
- [ ] Final testing

### Phase 5: Deployment (1-2 hours)
- [ ] Deploy to staging
- [ ] Verify in staging environment
- [ ] Deploy to production
- [ ] Monitor error dashboard

## Common Migration Issues

### Issue 1: Circular Dependencies

**Problem:** Error tracking imports cause circular dependencies

**Solution:** Use dynamic imports:
```tsx
const { errorTracker } = await import('@/lib/error-tracking');
```

### Issue 2: SSR Compatibility

**Problem:** Error tracking code runs on server

**Solution:** Check for browser environment:
```tsx
if (typeof window !== 'undefined') {
  await errorTracker.captureError(error, context);
}
```

### Issue 3: Async/Await Issues

**Problem:** Error tracking is async but error handling is sync

**Solution:** Use void operator:
```tsx
void errorTracker.captureError(error, context);
```

### Issue 4: Missing Context

**Problem:** Error context is incomplete

**Solution:** Always provide context:
```tsx
await errorTracker.captureError(error, {
  component: 'ComponentName',
  action: 'actionName',
  userId: user?.id,
  metadata: { /* relevant data */ },
});
```

## Testing Migration

### Unit Tests

Update tests to mock error tracking:
```tsx
import { vi } from 'vitest';
import { errorTracker } from '@/lib/error-tracking';

vi.mock('@/lib/error-tracking', () => ({
  errorTracker: {
    captureError: vi.fn(),
  },
}));

it('should capture error', async () => {
  await myFunction();
  expect(errorTracker.captureError).toHaveBeenCalled();
});
```

### Integration Tests

Test error tracking end-to-end:
```tsx
it('should track error in database', async () => {
  await triggerError();
  
  const errors = await prisma.errorLog.findMany({
    where: { message: 'Test error' },
  });
  
  expect(errors).toHaveLength(1);
});
```

## Rollback Plan

If migration causes issues:

1. **Revert to old error handling:**
   ```bash
   git revert <commit-hash>
   ```

2. **Disable error tracking:**
   ```env
   NEXT_PUBLIC_ENABLE_ERROR_TRACKING=false
   ```

3. **Keep both systems temporarily:**
   ```tsx
   // Old system
   console.error(error);
   
   // New system
   await errorTracker.captureError(error, context);
   ```

## Performance Considerations

- Error tracking is non-blocking
- Use `void` operator to avoid awaiting
- Batch errors before sending
- Implement error deduplication
- Monitor error volume

## Success Criteria

✅ **Migration is successful when:**
- All error handling code is migrated
- No sessionStorage usage for errors
- All errors appear in Sentry
- All errors appear in database
- Error context is complete
- Tests pass
- Performance is acceptable
- Team is trained

## Support

For migration help:
1. Review ERROR_TRACKING_SETUP.md
2. Check migration patterns above
3. Review test examples
4. Ask team for help

## Timeline

- **Week 1:** Setup and core components
- **Week 2:** Hooks and utilities
- **Week 3:** Testing and cleanup
- **Week 4:** Deployment and monitoring

---

**Migration Guide Version:** 1.0.0
**Last Updated:** 2024-01-15
