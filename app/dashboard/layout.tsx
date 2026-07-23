import type { Metadata } from 'next';
import { ErrorBoundary } from '@/components/error-boundary';

export const metadata: Metadata = {
  title: 'Dashboard',
  description: 'Manage your projects, bounties, and earnings on Stellar Creator Portfolio.',
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ErrorBoundary>{children}</ErrorBoundary>;
}
