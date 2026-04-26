# PWA Quick Start Guide

## 5-Minute Setup

### 1. Copy Core Files

```bash
# Service Worker
cp sw.js public/

# Manifest
cp manifest.json public/

# Offline page
cp offline.html public/

# Utilities
cp pwa-utils.ts lib/

# Components
mkdir -p components/pwa
cp pwa-head.tsx components/pwa/
cp pwa-provider.tsx components/pwa/
cp install-prompt.tsx components/pwa/
cp network-status.tsx components/pwa/
cp update-notification.tsx components/pwa/
```

### 2. Update Layout

Replace your `app/layout.tsx`:

```tsx
import PWAHead from '@/components/pwa/pwa-head';
import PWAProvider from '@/components/pwa/pwa-provider';
import InstallPrompt from '@/components/pwa/install-prompt';
import NetworkStatus from '@/components/pwa/network-status';
import UpdateNotification from '@/components/pwa/update-notification';

export const metadata = {
  manifest: '/manifest.json',
  // ... other metadata
};

export default function RootLayout({ children }) {
  return (
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#000000" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/icons/icon-180.png" />
        <PWAHead />
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

### 3. Add Icons

Create these icon files in `public/icons/`:

- `icon-192.png` (192x192)
- `icon-512.png` (512x512)

Quick option - use [favicon-generator.org](https://www.favicon-generator.org/):
1. Upload your logo
2. Download icons
3. Place in `public/icons/`

### 4. Update Manifest

Edit `public/manifest.json`:

```json
{
  "name": "Your App Name",
  "short_name": "Your App",
  "description": "Your app description",
  "start_url": "/",
  "display": "standalone",
  "theme_color": "#000000",
  "background_color": "#ffffff"
}
```

### 5. Test Locally

```bash
npm run dev
# Visit http://localhost:3000
# Open DevTools (F12) → Application → Service Workers
```

## Verification Checklist

- [ ] `/public/manifest.json` exists
- [ ] `/public/sw.js` exists
- [ ] `/public/offline.html` exists
- [ ] `/public/icons/icon-192.png` exists
- [ ] `/public/icons/icon-512.png` exists
- [ ] `components/pwa/` directory created
- [ ] All PWA components imported in layout
- [ ] PWAProvider wraps children in layout
- [ ] Service Worker registered (check DevTools)
- [ ] Manifest linked in head

## Quick Usage

### Check if Online

```tsx
import { usePWA } from '@/components/pwa/pwa-provider';

export default function MyComponent() {
  const { isOnline } = usePWA();
  
  return <p>{isOnline ? '🟢 Online' : '🔴 Offline'}</p>;
}
```

### Prompt Installation

```tsx
import { usePWA } from '@/components/pwa/pwa-provider';

export default function MyComponent() {
  const { promptInstall } = usePWA();
  
  return (
    <button onClick={() => promptInstall()}>
      Install App
    </button>
  );
}
```

### Send Notification

```tsx
import { usePWA } from '@/components/pwa/pwa-provider';

export default function MyComponent() {
  const { sendNotification } = usePWA();
  
  return (
    <button onClick={() => sendNotification('Hello!', {
      body: 'This is a notification'
    })}>
      Send Notification
    </button>
  );
}
```

## Lighthouse Audit

In Chrome DevTools:

1. Open DevTools (F12)
2. Click Lighthouse tab
3. Select "Progressive Web App"
4. Click "Analyze page load"

Target: Score > 90

## Common Issues

### Service Worker Not Registering

- Must be HTTPS (or localhost)
- Check `/sw.js` is accessible
- Check browser console for errors

### Icons Not Showing

- Icons must be in `/public/icons/`
- Update `manifest.json` icon paths
- Restart dev server

### Offline Page Not Working

- Ensure `/offline.html` exists
- Service Worker must be active
- Check cache in DevTools

## Next Steps

1. ✅ Basic setup (you are here)
2. Add push notifications (see guide)
3. Customize icons (AppIcon.co)
4. Run tests (npm test)
5. Deploy (Vercel/Netlify)

## Get Help

- Full guide: `PWA_IMPLEMENTATION_GUIDE.md`
- Test examples: `/tests` directory
- Component examples: `/components/pwa`

## Deployment

### Vercel
```bash
vercel deploy
```
PWA works automatically!

### Other Platforms
- Enable HTTPS ✓
- Service Worker accessible ✓
- Correct headers set ✓

That's it! Your app is now a PWA. 🎉

---

**Pro Tip**: Use Android device or Chrome emulation to test installation and offline features.
