import type { Metadata, Viewport } from 'next'
import Script from 'next/script'
import { Geist, Geist_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { ThemeProvider } from 'next-themes'
import { SessionProvider } from '@/components/providers/session-provider'
import { Toaster } from '@/components/ui/sonner'
import AnalyticsClient from './providers/AnalyticsClient'
import { clientConfig } from '@/lib/config'
import './globals.css'

const _geist = Geist({ subsets: ["latin"] });
const _geistMono = Geist_Mono({ subsets: ["latin"] });

const PLAUSIBLE_DOMAIN = clientConfig.analytics.plausibleDomain
const PLAUSIBLE_SRC = clientConfig.analytics.plausibleSrc
const PLAUSIBLE_API_ENDPOINT = clientConfig.analytics.plausibleApi

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#5a4ba3' },
    { media: '(prefers-color-scheme: dark)', color: '#a78bfa' },
  ],
}

export const metadata: Metadata = {
  title: 'Stellar Creators | Portfolio & Bounty Platform',
  description: 'Discover world-class creators across UI/UX design, writing, and content creation. Showcase your work, collaborate, and participate in exciting bounties.',
  keywords: ['creators', 'portfolio', 'bounty', 'design', 'writing', 'content creation', 'freelance', 'showcase'],
  generator: 'v0.app',
  openGraph: {
    title: 'Stellar Creators | Portfolio & Bounty Platform',
    description: 'Discover and collaborate with world-class creators across multiple disciplines.',
    type: 'website',
  },
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <PlausibleScript />
      </head>
      <body className="font-sans antialiased">
        <SessionProvider>
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
            <AnalyticsClient plausibleDomain={PLAUSIBLE_DOMAIN} />
            {children}
            <Toaster richColors closeButton position="top-right" />
            <Analytics />
          </ThemeProvider>
        </SessionProvider>
      </body>
    </html>
  )
}

function PlausibleScript() {
  return (
    <>
      <Script
        id="plausible-script"
        strategy="lazyOnload"
        data-domain={PLAUSIBLE_DOMAIN}
        data-api={PLAUSIBLE_API_ENDPOINT}
        src={PLAUSIBLE_SRC}
      />
      <Script id="plausible-queue" strategy="lazyOnload">
        {`
          window.plausible = window.plausible || function() {
            (window.plausible.q = window.plausible.q || []).push(arguments)
          }
        `}
      </Script>
    </>
  )
}
