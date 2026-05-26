import type { Metadata, Viewport } from 'next';
import { ReactNode } from 'react';
// Commenting out missing PWA components to pass baseline checks
// import PWAHead from '@/components/pwa/pwa-head';
// import PWAProvider from '@/components/pwa/pwa-provider';
import './globals.css';

export const metadata: Metadata = {
  // Basic metadata
  title: {
    default: 'Stellar Creator Portfolio',
    template: '%s | Stellar Creator Portfolio',
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
    title: 'Stellar Portfolio',
  },

  // Open Graph for social sharing
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://your-portfolio.com',
    siteName: 'Stellar Creator Portfolio',
    title: 'Stellar Creator Portfolio',
    description:
      'Professional creator portfolio with native app-like experience',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Stellar Creator Portfolio',
      },
    ],
  },

  // Twitter Card
  twitter: {
    card: 'summary_large_image',
    title: 'Stellar Creator Portfolio',
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
        <meta name="application-name" content="Stellar Portfolio" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Stellar Portfolio" />
        <meta name="theme-color" content="#000000" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: dark)" />

        {/* Icons */}
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/icons/icon-180.png" />

        {/* Manifest */}
        <link rel="manifest" href="/manifest.json" />

        {/* Fonts */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />

        {/* DNS Prefetch for external resources */}
        <link rel="dns-prefetch" href="https://www.googletagmanager.com" />
        <link rel="dns-prefetch" href="https://www.google-analytics.com" />

        {/* PWA Head Component - Commented out due to missing file */}
        {/* <PWAHead /> */}
      </head>
      <body>
        {/* PWAProvider - Commented out due to missing file */}
        {/* <PWAProvider> */}
          {children}
        {/* </PWAProvider> */}
      </body>
    </html>
  );
}