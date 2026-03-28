# PWA (Progressive Web App) Implementation Guide

## Overview

This implementation provides a complete Progressive Web App solution for the Stellar Creator Portfolio, including:

- ✅ Service Worker for offline functionality
- ✅ Web App Manifest for installability
- ✅ Push notifications
- ✅ Advanced caching strategies
- ✅ Offline page fallback
- ✅ Network status monitoring
- ✅ Installation prompts
- ✅ Performance optimizations

## File Structure

```
/public
├── manifest.json                 # Web app manifest
├── sw.js                         # Service Worker
├── offline.html                  # Offline fallback page
├── icons/
│   ├── icon-192.png            # App icon 192x192
│   ├── icon-192-maskable.png   # Maskable icon for adaptive icons
│   ├── icon-512.png            # App icon 512x512
│   └── icon-512-maskable.png   # Maskable icon 512x512
└── screenshots/
    ├── screenshot-540.png       # Narrow form factor
    └── screenshot-1280.png      # Wide form factor

/app
└── layout.tsx                   # Main layout with PWA meta tags

/components/pwa
├── pwa-head.tsx                # PWA head component
├── pwa-provider.tsx            # PWA context provider
├── install-prompt.tsx          # Install prompt component
├── network-status.tsx          # Network status indicator
└── update-notification.tsx     # Update notification

/lib
└── pwa-utils.ts                # PWA utility functions

/tests
├── service-worker.test.ts      # Service Worker tests
├── pwa-integration.test.ts     # Integration tests
├── pwa-e2e.spec.ts            # E2E tests
└── lighthouse-pwa.test.ts      # Performance tests
```

## Installation & Setup

### 1. Copy Files to Your Project

Copy the following files to your project:

```bash
# Public files
cp manifest.json public/
cp sw.js public/
cp offline.html public/

# Components
cp pwa-head.tsx components/pwa/
cp pwa-provider.tsx components/pwa/
cp install-prompt.tsx components/pwa/
cp network-status.tsx components/pwa/
cp update-notification.tsx components/pwa/

# Utilities
cp pwa-utils.ts lib/

# Tests
cp service-worker.test.ts tests/
cp pwa-integration.test.ts tests/
cp pwa-e2e.spec.ts tests/
cp lighthouse-pwa.test.ts tests/
```

### 2. Update Layout File

Use the provided `layout.tsx` as your main app layout, or integrate the PWA components:

```tsx
import PWAHead from '@/components/pwa/pwa-head';
import PWAProvider from '@/components/pwa/pwa-provider';
import InstallPrompt from '@/components/pwa/install-prompt';
import NetworkStatus from '@/components/pwa/network-status';
import UpdateNotification from '@/components/pwa/update-notification';

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <PWAHead />
        {/* ... other head content ... */}
      </head>
      <body>
        <PWAProvider>
          <NetworkStatus />
          <InstallPrompt />
          <UpdateNotification />
          {children}
        </PWAProvider>
      </body>
    </html>
  );
}
```

### 3. Create App Icons

You'll need to create icons for your app. Minimum requirements:

- **192x192px** - Standard app icon (PNG)
- **192x192px maskable** - For adaptive icons on Android
- **512x512px** - Large app icon (PNG)
- **512x512px maskable** - For adaptive icons on Android

Tools to create these:
- [favicon-generator.org](https://www.favicon-generator.org/)
- [AppIcon.co](https://appicon.co/)
- [IconKitchen](https://icon.kitchen/)

### 4. Generate Vapid Keys for Push Notifications

```bash
npm install --save-dev web-push

# Generate VAPID keys
npx web-push generate-vapid-keys
```

Save the keys in your `.env.local`:

```env
NEXT_PUBLIC_VAPID_PUBLIC_KEY=your_public_key
VAPID_PRIVATE_KEY=your_private_key
VAPID_EMAIL=admin@example.com
```

### 5. Update Environment Variables

```env
# .env.local
NEXT_PUBLIC_VAPID_PUBLIC_KEY=your_public_key
VAPID_PRIVATE_KEY=your_private_key
```

## Usage

### Using PWA Hook

```tsx
'use client';

import { usePWA } from '@/components/pwa/pwa-provider';

export default function MyComponent() {
  const { isOnline, isInstallable, promptInstall, sendNotification } = usePWA();

  return (
    <div>
      <p>Online: {isOnline ? '✓' : '✕'}</p>
      {isInstallable && (
        <button onClick={() => promptInstall()}>
          Install App
        </button>
      )}
      <button onClick={() => sendNotification('Hello!', {
        body: 'This is a notification'
      })}>
        Send Notification
      </button>
    </div>
  );
}
```

### Direct PWA Manager Access

```tsx
import { pwa } from '@/lib/pwa-utils';

// Check if running as app
if (pwa.isRunningAsApp()) {
  console.log('Running as installed app');
}

// Request notifications
const granted = await pwa.requestNotificationPermission();

// Subscribe to push notifications
const subscription = await pwa.subscribeToPushNotifications();

// Send local notification
await pwa.sendNotification('Title', {
  body: 'Notification body',
  icon: '/icons/icon-192.png',
});

// Get cache storage usage
const usage = await pwa.getCacheStorageUsage();
console.log(`Cache usage: ${usage.percentage}%`);
```

## Manifest Configuration

Edit `manifest.json` to customize:

```json
{
  "name": "Your App Name",
  "short_name": "Short Name",
  "description": "App description",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "theme_color": "#000000",
  "background_color": "#ffffff",
  "icons": [...]
}
```

### Display Modes

- **`standalone`** - App looks like a native app (no browser UI)
- **`fullscreen`** - Fullscreen with no UI (immersive)
- **`minimal-ui`** - Minimal browser UI
- **`browser`** - Standard browser window

## Caching Strategies

The service worker implements four caching strategies:

### 1. Cache First
**Use for**: Static assets, images, fonts
- Returns cached response if available
- Falls back to network if not cached
- Minimizes network requests

### 2. Network First
**Use for**: API calls, dynamic content
- Tries network first
- Falls back to cache if offline
- Always keeps cache fresh

### 3. Stale While Revalidate
**Use for**: Secondary content
- Returns cached response immediately
- Updates cache in background
- Provides best UX with freshness

### 4. Navigation (Network First with Offline Fallback)
**Use for**: HTML pages
- Tries network first
- Falls back to cache
- Shows offline page as last resort

## Offline Features

### Offline Page

The `offline.html` page is served when:
- User tries to navigate to a page that's not cached
- Network is unavailable
- Page fetch fails

Customize it by editing `/public/offline.html`.

### Background Sync

Messages sent while offline are queued and synced when back online:

```tsx
import { pwa } from '@/lib/pwa-utils';

// Send message while offline - will sync automatically
await sendMessage({
  text: 'Hello',
  timestamp: Date.now(),
});
```

## Push Notifications

### Server-Side Setup

```typescript
import webpush from 'web-push';

// Configure
webpush.setVapidDetails(
  process.env.VAPID_EMAIL,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// Send notification
await webpush.sendNotification(subscription, JSON.stringify({
  title: 'Hello',
  body: 'You have a new message',
  icon: '/icons/icon-192.png',
  url: '/messages',
}));
```

### API Endpoint Example

```typescript
// pages/api/send-notification.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import webpush from 'web-push';

webpush.setVapidDetails(
  process.env.VAPID_EMAIL!,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).end();
  }

  try {
    const { subscription, title, body } = req.body;

    await webpush.sendNotification(subscription, JSON.stringify({
      title,
      body,
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-72.png',
    }));

    res.json({ success: true });
  } catch (error) {
    console.error('Push notification failed:', error);
    res.status(500).json({ error: 'Failed to send notification' });
  }
}
```

## Testing

### Run Unit Tests

```bash
npm run test -- service-worker.test.ts
```

### Run Integration Tests

```bash
npm run test -- pwa-integration.test.ts
```

### Run E2E Tests

```bash
npm run test:e2e -- pwa-e2e.spec.ts
```

### Run Performance Tests

```bash
npm run test -- lighthouse-pwa.test.ts
```

### Lighthouse PWA Audit

```bash
# Using Chrome DevTools
# 1. Open DevTools (F12)
# 2. Go to Lighthouse tab
# 3. Select "Progressive Web App"
# 4. Click "Analyze page load"

# Or use CLI
npm install -g lighthouse
lighthouse http://localhost:3000 --view
```

## Performance Optimization Tips

### 1. Optimize Icons

```bash
# Compress PNG icons
npx imagemin public/icons/*.png --out-dir=public/icons

# Use WebP for additional savings
npx cwebp public/icons/icon-192.png -o public/icons/icon-192.webp
```

### 2. Lazy Load Components

```tsx
import dynamic from 'next/dynamic';

const InstallPrompt = dynamic(
  () => import('@/components/pwa/install-prompt'),
  { loading: () => <></> }
);
```

### 3. Optimize Service Worker Size

- Remove unused code
- Minify the service worker
- Use code splitting for large handlers

### 4. Monitor Cache Size

```tsx
const usage = await pwa.getCacheStorageUsage();
if (usage && usage.percentage > 80) {
  // Warn user or clear old cache
  await pwa.clearAllCaches();
}
```

## Browser Support

| Feature | Chrome | Firefox | Safari | Edge |
|---------|--------|---------|--------|------|
| Service Workers | ✅ | ✅ | ✅ | ✅ |
| Web App Manifest | ✅ | ✅ | ⚠️ | ✅ |
| Push Notifications | ✅ | ✅ | ⚠️ | ✅ |
| Background Sync | ✅ | ✅ | ❌ | ✅ |
| Install Prompt | ✅ | ✅ | ✅ | ✅ |

## Troubleshooting

### Service Worker Not Registering

1. Check HTTPS (or localhost)
2. Verify `/sw.js` exists and is accessible
3. Check browser console for errors
4. Clear browser cache and reload

### Offline Page Not Showing

1. Make sure `/offline.html` exists
2. Verify service worker is active
3. Check cache keys in DevTools

### Notifications Not Working

1. Check notification permission
2. Verify VAPID keys are set
3. Ensure service worker is active
4. Check for CORS issues

### Cache Growing Too Large

1. Implement cache size limits
2. Delete old cache versions
3. Set expiry on cached items

## Security Considerations

1. **HTTPS Only** - Service Workers require HTTPS (except localhost)
2. **CSP Headers** - Set proper Content Security Policy
3. **Secure Cookies** - Use `Secure` and `SameSite` flags
4. **Authentication** - Implement secure auth with refresh tokens
5. **Sensitive Data** - Don't cache sensitive user data

## Lighthouse Scoring

To achieve a Lighthouse PWA score of >90:

- ✅ Has manifest.json
- ✅ App icon exists
- ✅ Service Worker registered
- ✅ Works offline
- ✅ Responsive design
- ✅ Viewport meta tag
- ✅ Theme color meta tag
- ✅ No console errors
- ✅ Load time < 3s (3G)
- ✅ Paint timing optimized

## Monitoring & Analytics

Track PWA events:

```typescript
// Automatic event tracking via pwa-utils.ts
// Events:
- 'pwa_service-worker-registered'
- 'pwa_app-installed'
- 'pwa_network-online'
- 'pwa_network-offline'
- 'pwa_update-available'
- 'pwa_push-subscribed'
- 'pwa_notification-permission'
```

## Deployment

### Vercel

PWA works out of the box with Vercel:

```bash
vercel deploy
```

### Other Platforms

Ensure:
1. HTTPS is enabled
2. Correct headers are set
3. Service Worker can be served
4. Cache-Control headers are appropriate

## Additional Resources

- [Web.dev PWA Guide](https://web.dev/progressive-web-apps/)
- [MDN Service Workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)
- [Web App Manifest Spec](https://www.w3.org/TR/appmanifest/)
- [Lighthouse PWA Audit](https://web.dev/lighthouse-pwa/)

## Support & Issues

For issues or questions:

1. Check the troubleshooting section
2. Review the test files for examples
3. Check browser console for errors
4. Use DevTools Network/Application tabs

## License

This implementation is provided as-is for the Stellar Creator Portfolio project.
