import type { Metadata, Viewport } from 'next';
import { ReactNode } from 'react';
import './globals.css';

// NOTE: components/pwa/ (PWAHead, PWAProvider) does not exist in this repo.
// The PWA meta tags and manifest link below are written out directly instead;
// wire the components in here if they are ever added.

export const metadata: Metadata = {
  // Basic metadata
  title: {
    default: 'Tamgora',
    template: '%s | Tamgora',
  },
  description:
    'Professional creator portfolio with native app-like experience. Showcase your work, engage with your audience, and build your brand.',
  keywords: [
    'portfolio',
    'creator',
    'professional',
    'showcase',
    'web app',
    'pwa',
  ],
  authors: [{ name: 'Your Name' }],
  creator: 'Your Name',

  // PWA metadata
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Tamgora',
  },

  // Open Graph for social sharing
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://your-portfolio.com',
    siteName: 'Tamgora',
    title: 'Tamgora',
    description:
      'Professional creator portfolio with native app-like experience',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Tamgora',
      },
    ],
  },

  // Twitter Card
  twitter: {
    card: 'summary_large_image',
    title: 'Tamgora',
    description:
      'Professional creator portfolio with native app-like experience',
    images: ['/twitter-image.png'],
    creator: '@yourhandle',
  },

  // Other metadata
  formatDetection: {
    email: false,
    telephone: false,
    address: false,
  },
  referrer: 'origin-when-cross-origin',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  minimumScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
  ],
};

interface RootLayoutProps {
  children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* PWA Meta Tags */}
        <meta name="application-name" content="Tamgora" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Tamgora" />
        <meta name="theme-color" content="#000000" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: dark)" />

        {/* Icons — aria-label added for accessibility on icon-only link elements */}
        <link rel="icon" href="/favicon.ico" sizes="any" aria-label="Tamgora favicon" />
        <link rel="icon" href="/icon.svg" type="image/svg+xml" aria-label="Tamgora icon" />
        <link rel="apple-touch-icon" href="/icons/icon-180.png" aria-label="Tamgora apple touch icon" />

        {/* Manifest */}
        <link rel="manifest" href="/manifest.json" aria-label="PWA manifest" />

        {/* Fonts */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />

        {/* DNS Prefetch for external resources */}
        <link rel="dns-prefetch" href="https://www.googletagmanager.com" />
        <link rel="dns-prefetch" href="https://www.google-analytics.com" />

      </head>
      <body>
        {/* Skip-to-content link for keyboard navigation accessibility */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-black focus:shadow-lg"
          aria-label="Skip to main content"
        >
          Skip to main content
        </a>
        <div id="main-content" role="main">
          {children}
        </div>
      </body>
    </html>
  );
}
