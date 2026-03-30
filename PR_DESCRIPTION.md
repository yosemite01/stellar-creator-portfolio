# fix: hardening — WebSocket route, cache mocks, image optimization, tsconfig

## Summary

Four independent hardening fixes bundled into a single PR.

---

## 1. `app/api/messages/route.ts` — WebSocket upgrade hardened & documented

**Problem:** The route attempted WebSocket upgrades via a Deno-specific or runtime-specific `request.webSocket` fallback with no documentation, no error handling, and no clear behaviour for unsupported runtimes.

**Fix:**
- Added inline documentation explaining which runtimes are supported (Deno Deploy / edge) and why Node.js route handlers cannot handle raw socket upgrades.
- Added an explicit `426 Upgrade Required` response when the `Upgrade: websocket` header is missing.
- Wrapped the Deno upgrade path in a `try/catch` returning `500` on failure.
- Returns `501 Not Implemented` with a clear message on Node.js / standard Next.js runtimes, pointing to the custom-server approach.
- Set `export const runtime = "edge"` to make the edge requirement explicit.

---

## 2. `app/pwa/service-worker.test.ts` — Typed cache mocks replace `as any` casts

**Problem:** `global.caches = mockCaches as any` was used in multiple places, bypassing TypeScript's type system and making it easy for mock drift to hide real bugs.

**Fix:**
- Introduced `createCacheMock()` — a fully typed `jest.Mocked<Cache>` backed by an in-memory `Map`, matching the browser `Cache` interface method-for-method.
- Introduced `createCacheStorageMock()` — a fully typed `jest.Mocked<CacheStorage>` that manages named caches, matching the browser `CacheStorage` interface.
- Replaced all `as any` assignments with `Object.defineProperty(globalThis, 'caches', ...)` using the typed mock.
- Expanded test coverage: open, put, match, delete, keys, and has() are all exercised.

---

## 3. `next.config.mjs` — Image optimization re-enabled

**Problem:** `images.unoptimized: true` disabled Next.js's built-in image optimization (resizing, format conversion, lazy loading), hurting Core Web Vitals and page performance.

**Fix:**
- Removed `unoptimized: true` so Next.js image optimization is active by default.
- Added `remotePatterns: []` as a ready-to-fill placeholder for external image hostnames.
- Added a comment explaining the one legitimate case to re-add `unoptimized: true` (static `output: 'export'` deployments) and what to do instead (CDN-level optimizer).

---

## 4. `tsconfig.json` — `allowJs` and `skipLibCheck` tightened

**Problem:** `allowJs: true` silently allowed untyped JavaScript files into the TypeScript compilation, and `skipLibCheck: true` skipped type-checking of all `.d.ts` files in `node_modules`, both of which can hide real type errors.

**Fix:**
- Set `allowJs: false` — the project is TypeScript-only; any `.js` files should be migrated or explicitly excluded.
- Set `skipLibCheck: false` — type errors in declaration files are now surfaced. If a specific third-party package has broken types, add it to a targeted `skipLibCheck` override or use a `@types` patch rather than suppressing all checks.
- Kept `strict: true` to ensure the full strict suite (noImplicitAny, strictNullChecks, etc.) remains active.

---

## Testing

- Run `tsc --noEmit` to verify no new type errors are introduced.
- Run the service-worker test suite: `jest app/pwa/service-worker.test.ts`
- Deploy to a Deno-compatible edge runtime and verify WebSocket connections upgrade correctly.
- Verify `<Image>` components load correctly with optimization enabled (check Network tab for WebP/AVIF responses from `/_next/image`).
