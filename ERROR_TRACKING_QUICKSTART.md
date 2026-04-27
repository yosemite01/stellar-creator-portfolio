# Error Tracking Quick Start Guide

Get centralized error tracking up and running in 5 minutes.

## 1. Install Dependencies (1 min)

```bash
npm install @sentry/nextjs
```

## 2. Configure Environment (1 min)

Add to `.env.local`:

```env
NEXT_PUBLIC_SENTRY_DSN=https://your-key@sentry.io/project-id
NEXT_PUBLIC_SENTRY_ENVIRONMENT=development
NEXT_PUBLIC_ENABLE_ERROR_TRACKING=true
```

Get your Sentry DSN from: https://sentry.io/settings/projects/

## 3. Setup Database (1 min)

```bash
npx prisma migrate dev --name add_error_log_model
```

## 4. Update Root Layout (1 min)

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

## 5. Start Using (1 min)

### Capture Errors

```tsx
import { errorTracker } from '@/lib/error-tracking';

try {
  // Your code
} catch (error) {
  await errorTracker.captureError(error, {
    component: 'MyComponent',
    action: 'myAction',
  });
}
```

### Use Hooks

```tsx
import { useCaptureError, useAddBreadcrumb } from '@/hooks/useErrorTracking';

export function MyComponent() {
  const captureError = useCaptureError();
  const addBreadcrumb = useAddBreadcrumb();

  const handleClick = async () => {
    addBreadcrumb('Button clicked', 'user-action');
    try {
      await someOperation();
    } catch (error) {
      await captureError(error, { component: 'MyComponent' });
    }
  };

  return <button onClick={handleClick}>Click</button>;
}
```

### Wrap API Calls

```tsx
import { fetchWithTracking } from '@/lib/api-with-tracking';

const data = await fetchWithTracking('/api/data', {
  context: { component: 'MyComponent' },
});
```

## Verify It Works

1. Add test button to a page:
```tsx
import { errorTracker } from '@/lib/error-tracking';

export function TestError() {
  return (
    <button
      onClick={async () => {
        await errorTracker.captureError(new Error('Test error'), {
          component: 'TestError',
        });
      }}
    >
      Test Error
    </button>
  );
}
```

2. Click the button
3. Check:
   - Browser console (should see logs)
   - Network tab (POST to `/api/errors/log`)
   - Sentry dashboard (error should appear)
   - Database (query `SELECT * FROM "ErrorLog"`)

## Next Steps

- Read [ERROR_TRACKING_SETUP.md](./ERROR_TRACKING_SETUP.md) for detailed setup
- Read [ERROR_TRACKING_VERIFICATION.md](./ERROR_TRACKING_VERIFICATION.md) for verification steps
- Set up Sentry alerts in dashboard
- Configure error rate thresholds
- Train team on error tracking

## Common Issues

**Errors not appearing in Sentry?**
- Verify `NEXT_PUBLIC_SENTRY_DSN` is correct
- Check browser console for errors
- Verify Sentry project is active

**Errors not in database?**
- Verify `/api/errors/log` endpoint exists
- Check database connection
- Run migration: `npx prisma migrate dev`

**High error volume?**
- Review error filtering in Sentry
- Implement error deduplication
- Set up error rate limits

## API Endpoints

```bash
# Log error (automatic)
POST /api/errors/log

# Get error logs
GET /api/errors/log?limit=50&offset=0

# Get error statistics
GET /api/errors/stats?hours=24
```

## Key Files

- `lib/error-tracking.ts` - Core error tracking
- `lib/error-handling.ts` - Error formatting
- `lib/api-with-tracking.ts` - API wrapper
- `hooks/useErrorTracking.ts` - React hooks
- `components/error-tracking-provider.tsx` - Provider
- `app/api/errors/log/route.ts` - Backend endpoint
- `app/api/errors/stats/route.ts` - Statistics endpoint

## Support

For issues or questions:
1. Check ERROR_TRACKING_SETUP.md
2. Check ERROR_TRACKING_VERIFICATION.md
3. Review test file: `__tests__/error-tracking.test.ts`
4. Check Sentry documentation: https://docs.sentry.io/

---

**Ready to go!** 🚀
