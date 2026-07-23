import type { Metadata } from 'next';
import { ErrorBoundary } from '@/components/error-boundary';

export const metadata: Metadata = {
  title: 'Bounty Directory',
  description:
    'Browse available bounties across design, content creation, development, and marketing. Find exciting paid opportunities and collaborate with top talent.',
  openGraph: {
    title: 'Bounty Directory — Stellar Creator Portfolio',
    description:
      'Browse available bounties across design, content creation, development, and marketing.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Bounty Directory — Stellar Creator Portfolio',
    description:
      'Browse available bounties across design, content creation, development, and marketing.',
  },
};

export default function BountiesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ErrorBoundary>{children}</ErrorBoundary>;
}
