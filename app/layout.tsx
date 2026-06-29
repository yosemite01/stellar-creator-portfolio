import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { ThemeProvider } from "next-themes";
import { LayoutProvider } from "@/components/layout-provider";
import { DataLoaderProvider } from "@/app/providers/DataLoaderProvider";
import { WalletProvider } from "@/contexts/WalletContext";
import "./globals.css";

const _geist = Geist({ subsets: ["latin"] });
const _geistMono = Geist_Mono({ subsets: ["latin"] });

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#6166f1" },
    { media: "(prefers-color-scheme: dark)", color: "#a78bfa" },
  ],
  colorScheme: "light dark",
};

export const metadata: Metadata = {
  title: {
    default: "Stellar Creator Portfolio — Discover Top Creative Talent",
    template: "%s — Stellar Creator Portfolio",
  },
  description:
    "Discover, hire, and collaborate with exceptional creators across design, writing, marketing, product management, and 10+ more disciplines. Post bounties, find freelancers, and build amazing projects.",
  keywords: [
    "creators",
    "portfolio",
    "bounty",
    "design",
    "writing",
    "content creation",
    "freelance",
    "showcase",
    "stellar",
  ],
  generator: "v0.app",
  openGraph: {
    title: "Stellar Creator Portfolio — Discover Top Creative Talent",
    description:
      "Discover, hire, and collaborate with exceptional creators across design, writing, marketing, product management, and 10+ more disciplines.",
    type: "website",
    siteName: "Stellar Creator Portfolio",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stellar Creator Portfolio — Discover Top Creative Talent",
    description:
      "Discover, hire, and collaborate with exceptional creators across design, writing, marketing, product management, and 10+ more disciplines.",
  },
  robots: { index: true, follow: true },
  icons: {
    icon: [
      {
        url: "/icon-light-32x32.png",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/icon-dark-32x32.png",
        media: "(prefers-color-scheme: dark)",
      },
      {
        url: "/icon.svg",
        type: "image/svg+xml",
      },
    ],
    apple: "/apple-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="scroll-smooth">
      <body className="font-sans antialiased transition-smooth">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange={false}
        >
          <WalletProvider>
            <DataLoaderProvider>
              <LayoutProvider>{children}</LayoutProvider>
            </DataLoaderProvider>
          </WalletProvider>
          <Analytics />
        </ThemeProvider>
      </body>
    </html>
  );
}
