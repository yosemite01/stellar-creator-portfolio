# PWA: Background Sync for Drafts and Push Notification Reliability

**Issue:** [#1776](https://github.com/yosemite01/stellar-creator-portfolio/issues/1776)  
**Difficulty:** Hard · **Estimated size:** L (1–2 weeks)

---

## Background

The app has a service worker, an IndexedDB mutation queue, and a push subscription flow. The problems are: the service worker is hand-written (no Workbox), draft mutations are split across two separate IndexedDB databases that don't share replay logic, and push subscriptions are never renewed after they expire (browsers invalidate them after ~30 days). Creators on mobile networks lose draft work and stop receiving push notifications silently.

---

## Current State

### Service worker — `public/sw.js`

The service worker is a hand-rolled plain JavaScript file. It implements:

| Strategy | Routes |
|---|---|
| Cache-first | `/_next/static/*`, `.js/.css/font` extensions |
| Stale-while-revalidate | Image extensions |
| Network-first (5s timeout) | `/api/*` |
| Network-first (8s timeout) | `navigate` mode (HTML pages) |
| Offline queue | Non-GET mutations |

Non-GET requests are stored in an IndexedDB database (`stellar-sw-queue`, store `mutations`). A `sync` event listener handles the `stellar-mutation-queue` tag and replays records via `replayMutationQueue()`. Failed records remain in the queue for the next sync event.

### Client-side queue — `lib/sw/offline-queue.ts`

A second, separate IndexedDB database (`stellar-offline-queue`) holds client-queued mutations. Key exports:

- `enqueue(mutation)` — writes to IndexedDB and calls `reg.sync.register('stellar-mutation-queue')`.
- `enqueueBountyApplication(payload, bountyTitle)` — typed helper for bounty submissions; calls `registerOnlineFlush()` as a fallback.
- `flush()` — directly replays all entries from the page; used when `SyncManager` is absent.
- `registerOnlineFlush()` — one-time `window.online` listener that calls `flush()` only when Background Sync is not supported.
- `listQueuedBountyApplications()` — returns only `type === 'bounty-application'` entries.

**Critical gap:** The SW (`stellar-sw-queue`) and the page queue (`stellar-offline-queue`) are separate databases. When the Background Sync event fires in the service worker, only `stellar-sw-queue` is replayed. Mutations added by the page via `enqueue()` are only replayed by the page-side `flush()` or the `window.online` listener — not by the Background Sync path.

### PWA utilities — `lib/pwa/pwa-utils.ts`

`PWAManager` registers the service worker, polls for SW updates every 60 seconds, and exposes `subscribeToPushNotifications()`. The push subscription flow:
1. Requests `Notification` permission.
2. Calls `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: VAPID_KEY })`.
3. POSTs the subscription JSON to `/api/push-subscriptions`.

**Gaps:**
- No `pushsubscriptionchange` event handler → expired subscriptions are never renewed.
- `/api/push-subscriptions` route handler does not exist in the codebase.
- No periodic subscription validity check.

---

## Proposed Implementation

### 1. Workbox background sync for draft saves

Replace the hand-written service worker with a Workbox-generated one.

```bash
pnpm add -D workbox-webpack-plugin workbox-window
pnpm add workbox-background-sync workbox-routing workbox-strategies workbox-precaching
```

Create `sw-src/service-worker.ts` (TypeScript source for the SW):

```ts
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { NetworkFirst, CacheFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { BackgroundSyncPlugin } from 'workbox-background-sync';
import { ExpirationPlugin } from 'workbox-expiration';

declare const self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);  // injected by workbox-webpack-plugin
cleanupOutdatedCaches();

// Background sync plugin: retries failed mutations for up to 24 hours
const bgSyncPlugin = new BackgroundSyncPlugin('draft-mutation-queue', {
  maxRetentionTime: 24 * 60,          // minutes
});

// Draft saves and bounty applications — POST/PATCH with background sync
registerRoute(
  ({ request, url }) =>
    request.method !== 'GET' &&
    (url.pathname.startsWith('/api/bounty-applications') ||
      url.pathname.startsWith('/api/drafts')),
  new NetworkFirst({
    cacheName: 'draft-api',
    plugins: [bgSyncPlugin],
  }),
  'POST',
);

// API routes — network-first, 5s timeout
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/'),
  new NetworkFirst({ networkTimeoutSeconds: 5, cacheName: 'api-cache' }),
);

// Static assets — cache-first
registerRoute(
  ({ url }) => url.pathname.startsWith('/_next/static/'),
  new CacheFirst({ cacheName: 'static-assets', plugins: [new ExpirationPlugin({ maxAgeSeconds: 365 * 24 * 60 * 60 })] }),
);

// Images — stale-while-revalidate
registerRoute(
  ({ request }) => request.destination === 'image',
  new StaleWhileRevalidate({ cacheName: 'images', plugins: [new ExpirationPlugin({ maxEntries: 100 })] }),
);

// Navigation — network-first with /offline.html fallback
registerRoute(
  new NavigationRoute(
    new NetworkFirst({ networkTimeoutSeconds: 8, cacheName: 'pages' }),
    { allowlist: [/^(?!\/_next\/|\/api\/).*/] },
  ),
);
```

Add `workbox-webpack-plugin` to `next.config.js` using the `next-pwa` or `@ducanh2912/next-pwa` integration, or configure `InjectManifest` manually:

```js
const { InjectManifest } = require('workbox-webpack-plugin');

module.exports = {
  webpack(config, { isServer }) {
    if (!isServer) {
      config.plugins.push(
        new InjectManifest({
          swSrc: './sw-src/service-worker.ts',
          swDest: '../public/sw.js',
        }),
      );
    }
    return config;
  },
};
```

This generates `public/sw.js` at build time with a content-hashed precache manifest, eliminating the hardcoded `'v1'` cache version and stale-asset problem.

### 2. Unify the two IndexedDB queues

Remove `stellar-sw-queue` from `public/sw.js` and migrate all mutation queueing to Workbox's `BackgroundSyncPlugin`, which uses its own `workbox-background-sync` IndexedDB store. Remove the duplicate replay logic in `lib/sw/offline-queue.ts` (`flush()`, `registerOnlineFlush()`) and replace them with a Workbox queue query:

```ts
// lib/sw/offline-queue.ts — after migration
import { Queue } from 'workbox-background-sync';

const queue = new Queue('draft-mutation-queue', {
  maxRetentionTime: 24 * 60,
});

export async function enqueueDraftMutation(request: Request): Promise<void> {
  await queue.pushRequest({ request });
}
```

The `BackgroundSyncPlugin` handles both the `sync` event registration and replay automatically — no separate `flush()` needed.

### 3. Push subscription renewal on `pushsubscriptionchange`

Add a `pushsubscriptionchange` event handler to the service worker:

```ts
// sw-src/service-worker.ts — append
self.addEventListener('pushsubscriptionchange', async (event) => {
  event.waitUntil(
    (async () => {
      const registration = self.registration;
      const vapidKey = self.__VAPID_PUBLIC_KEY;  // injected at build time

      let newSubscription: PushSubscription;
      try {
        newSubscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: vapidKey,
        });
      } catch {
        // Browser rejected re-subscription (permission revoked) — nothing to do.
        return;
      }

      // Replace the old subscription on the server
      await fetch('/api/push-subscriptions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          old: (event as any).oldSubscription?.toJSON() ?? null,
          new: newSubscription.toJSON(),
        }),
      });
    })(),
  );
});
```

Create the `/api/push-subscriptions` route handler:

```ts
// app/api/push-subscriptions/route.ts
import { withRequestId } from '@/lib/request-id-middleware';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import { z } from 'zod';

const SubscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
});

// New subscription
export const POST = withRequestId(async (req: NextRequest) => {
  const session = await getServerSession();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = SubscriptionSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: 'Invalid' }, { status: 400 });

  await prisma.pushSubscription.upsert({
    where: { endpoint: body.data.endpoint },
    update: { p256dh: body.data.keys.p256dh, auth: body.data.keys.auth, userId: session.user.id },
    create: { endpoint: body.data.endpoint, p256dh: body.data.keys.p256dh, auth: body.data.keys.auth, userId: session.user.id },
  });
  return NextResponse.json({ ok: true });
});

// Subscription renewal (triggered by pushsubscriptionchange)
export const PUT = withRequestId(async (req: NextRequest) => {
  const { old: oldSub, new: newSub } = await req.json();
  if (oldSub?.endpoint) {
    await prisma.pushSubscription.deleteMany({ where: { endpoint: oldSub.endpoint } });
  }
  if (newSub?.endpoint) {
    await prisma.pushSubscription.upsert({
      where: { endpoint: newSub.endpoint },
      update: { p256dh: newSub.keys.p256dh, auth: newSub.keys.auth },
      create: { endpoint: newSub.endpoint, p256dh: newSub.keys.p256dh, auth: newSub.keys.auth, userId: 'unknown' },
    });
  }
  return NextResponse.json({ ok: true });
});
```

Add a `PushSubscription` model to `prisma/schema.prisma`:

```prisma
model PushSubscription {
  id        String   @id @default(cuid())
  userId    String
  endpoint  String   @unique
  p256dh    String
  auth      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

### 4. Offline UI

Add a banner component that reads `navigator.onLine` and updates on `window.online`/`window.offline`:

```tsx
// components/pwa/offline-banner.tsx
'use client';
import { useEffect, useState } from 'react';

export function OfflineBanner() {
  const [offline, setOffline] = useState(() =>
    typeof navigator !== 'undefined' ? !navigator.onLine : false
  );
  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  if (!offline) return null;
  return (
    <div role="alert" className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 rounded-lg bg-yellow-900/90 px-4 py-2 text-sm text-yellow-100 shadow-lg">
      You're offline — draft changes will sync when you reconnect.
    </div>
  );
}
```

Display queued mutation count using `listQueuedBountyApplications()` from `lib/sw/offline-queue.ts` so creators can see how many submissions are pending.

---

## Data Flow

```
Creator edits a draft (offline)
  │
  ▼
fetchWithTracking('/api/drafts', { method: 'PATCH', ... })
  │
Service Worker intercepts (NetworkFirst + BackgroundSyncPlugin)
  │  network fails → queued in workbox-background-sync IndexedDB
  │  returns 202 { queued: true }
  │
Device regains connectivity
  │
Browser fires 'sync' event: tag 'draft-mutation-queue'
  │
BackgroundSyncPlugin replays all queued requests
  │
Server receives PATCH /api/drafts
  │
Response → 200 OK
```

---

## Failure Modes

| Scenario | Behaviour |
|---|---|
| `BackgroundSyncPlugin` max retention exceeded (24h) | Mutation is dropped; UI should warn on next app load |
| Push permission revoked by user | `pushsubscriptionchange` subscription attempt throws; SW catches and returns silently |
| `/api/push-subscriptions` unreachable during renewal | SW retries on next `pushsubscriptionchange` event |
| Browser does not support Background Sync (`SyncManager` absent) | `BackgroundSyncPlugin` falls back to replaying on page load |
| Workbox SW not activated (user has old SW cached) | Old SW continues to serve; new SW activates after `skipWaiting()` on update |

---

## Test Plan

| Test | What to verify |
|---|---|
| Offline draft sync | Playwright: go offline, save a draft, go online → draft appears on server |
| `pushsubscriptionchange` | Unit test SW handler: `PUT /api/push-subscriptions` called with old + new sub |
| Offline banner | Render `<OfflineBanner>`, dispatch `window.offline` event → banner appears; dispatch `window.online` → banner disappears |
| Background Sync registration | `enqueue()` calls `reg.sync.register('draft-mutation-queue')` |
| `/api/push-subscriptions` route | POST with valid payload → 200; POST unauthenticated → 401 |

---

## Acceptance Criteria

- [ ] A draft saved while offline is reliably synced after reconnect (verified by Playwright test).
- [ ] Push subscriptions are renewed automatically when the browser fires `pushsubscriptionchange`.
- [ ] An offline indicator is shown to the creator when connectivity is lost.
- [ ] The dual-queue inconsistency is resolved: one database, one replay path.
- [ ] CI is green (lint, type-check, tests).
- [ ] No new TODOs without a linked issue.

---

## Definition of Done

- Code merged to `main` with tests.
- Acceptance criteria above all checked.
- PR description explains the change, links this issue (`Closes #1776`), and lists anything deferred.
- Docs updated where user-facing or integrator-facing behaviour changed.

---

## Getting Started

```bash
git clone https://github.com/yosemite01/stellar-creator-portfolio.git
cd stellar-creator-portfolio
pnpm install
cp .env.example .env.local
pnpm dev
pnpm typecheck && pnpm lint && pnpm test
pnpm test:e2e   # Playwright
```

Write a short design note in the PR (Workbox queue config, IndexedDB migration strategy, push subscription schema) before the bulk of the implementation.
