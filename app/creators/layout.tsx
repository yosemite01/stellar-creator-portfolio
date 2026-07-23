import type { Metadata } from 'next';
import { ErrorBoundary } from '@/components/error-boundary';

export const metadata: Metadata = {
  title: 'Creator Directory',
  description:
    'Explore our community of world-class creators. Filter by discipline to find the perfect talent for your project in UI/UX design, writing, marketing, and more.',
  openGraph: {
    title: 'Creator Directory — Stellar Creator Portfolio',
    description:
      'Explore our community of world-class creators. Filter by discipline to find the perfect talent for your project.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Creator Directory — Stellar Creator Portfolio',
    description:
      'Explore our community of world-class creators. Filter by discipline to find the perfect talent for your project.',
  },
};

export default function CreatorsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ErrorBoundary>{children}</ErrorBoundary>;
}
