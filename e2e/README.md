# End-to-End (E2E) Testing Guide

This directory contains Playwright end-to-end specifications for Tamgora.

## Available Test Suites

- `e2e/messaging.spec.ts`: Multi-context messaging test verifying message exchange, read receipts, and delivery between two isolated browser sessions (Client and Creator).
- `e2e/auth.spec.ts`: Stellar/Albedo wallet authentication flows.
- `e2e/pwa.spec.ts`: Progressive Web App installation, service worker caching, and offline access.
- `e2e/a11y.spec.ts`: Accessibility audits with axe-core.
- `e2e/upload.spec.ts`: Media upload validation.

## Running Tests Locally

### 1. Run all E2E tests:
```bash
pnpm run test:e2e
```

### 2. Run specifically the multi-context messaging suite:
```bash
pnpm exec playwright test e2e/messaging.spec.ts
```

### 3. Run with UI Mode (interactive debugger):
```bash
pnpm run test:e2e:ui
```

### 4. Run in headed browser mode:
```bash
pnpm exec playwright test e2e/messaging.spec.ts --headed
```
