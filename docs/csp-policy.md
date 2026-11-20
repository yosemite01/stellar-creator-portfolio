# Content Security Policy (CSP)

## Overview

Our CSP is configured in `proxy.ts` and enforces a strict security model using nonces, trusted types, and reporting.

## Policy Structure

```typescript
default-src 'self';
script-src 'self' 'nonce-{random}' 'strict-dynamic' 'trusted-types';
style-src 'self' 'unsafe-inline';  // Required for SSR hydration
img-src 'self' data: blob: https:;
font-src 'self' data:;
connect-src 'self' https: wss: https://*.google-analytics.com;
frame-src 'self';
object-src 'none';
base-uri 'self';
form-action 'self';
frame-ancestors 'none';
report-uri /api/csp-report;
```

## Security Features

### Nonce-based Script Execution

- Every request gets a unique nonce via `crypto.randomUUID()`
- Only scripts with matching `nonce="{nonce}"` attributes are allowed
- Prevents inline scripts from executing

### Trusted Types Integration

- `'trusted-types'` directive enables Trusted Types policy
- Must be used with a Trusted Types policy for script creation
- Prevents DOM XSS by validating script creation

### Strict-Dynamic

- `'strict-dynamic'` allows scripts with nonces to load child scripts
- Enables modern module loaders while maintaining security
- Older browsers that don't support strict-dynamic will ignore it

### Report-Only Mode

- Default: `Content-Security-Policy-Report-Only` header (reports only)
- Enable enforcement: `CSP_ENFORCE=true` environment variable

## Report Aggregation

The `/api/csp-report` endpoint:

1. **Rate Limits**: 30 reports per minute per IP
2. **Aggregates**: Groups violations by directive + blocked URI
3. **Logs**: Outputs to console without PII
4. **Stores**: Persists to DB when `CSP_ENFORCE=true`

### Statistics Endpoint

```
GET /api/csp-report?action=stats
```

Returns aggregated statistics:
- Total violations
- Unique violation patterns
- Time series data
- Sample violations

### Admin Management

- `GET /api/csp-report` - View current aggregations
- `DELETE /api/csp-report` - Clear aggregations (admin only)

## Migration Plan

### Phase 1: Report-Only (Current)
- Collect violations without blocking
- Identify and fix violations
- Monitor report volume

### Phase 2: Fix Violations
- Audit all inline scripts and add nonces
- Replace `eval()` with safe alternatives
- Update third-party scripts with CSP-compliant versions

### Phase 3: Strict CSP
- Remove `'unsafe-inline'` from script-src
- Add `require-trusted-types-for 'script'`
- Enforce full CSP

### Phase 4: Enhanced Security
- Enable Trusted Types policies
- Add subresource integrity (SRI)
- Implement CSP 3.0 features

## Testing

### Playwright Test

```typescript
import { test, expect } from '@playwright/test';

test('CSP violations should be zero on page crawl', async ({ page }) => {
  await page.goto('/');
  
  // Navigate all links
  const links = await page.locator('a[href]').all();
  for (const link of links) {
    const href = await link.getAttribute('href');
    if (href && !href.startsWith('mailto:') && !href.startsWith('#')) {
      await page.goto(new URL(href, page.url()).href);
    }
  }
  
  // Check for CSP violations in console
  const violations = [];
  page.on('console', msg => {
    if (msg.type() === 'error' && msg.text().includes('CSP')) {
      violations.push(msg.text());
    }
  });
  
  await page.waitForTimeout(1000);
  expect(violations.length).toBe(0);
});
```

### Manual Testing

1. Open browser DevTools
2. Go to any page
3. Check Console for CSP errors
4. Check Network tab for `/api/csp-report` calls
5. Run `GET /api/csp-report?action=stats` to see violations

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CSP_ENFORCE` | Enable full CSP enforcement | `false` |
| `NEXTAUTH_SECRET` | Used for nonce generation | Required |

## Compliance

- ✅ OWASP CSP Cheat Sheet
- ✅ Google CSP Best Practices
- ✅ RFC 23 Policy
- ✅ Trusted Types integration
- ✅ Nonce-based script execution
- ✅ Report-only monitoring
- ✅ Violation aggregation

## References

- [OWASP CSP Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html)
- [Google CSP Intro](https://developers.google.com/web/fundamentals/security/csp/)
- [Trusted Types](https://web.dev/trusted-types/)
- [MDN CSP Guide](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
