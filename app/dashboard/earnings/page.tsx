import { Suspense } from 'react';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { EarningsDashboard } from '@/components/analytics/earnings-dashboard';
import { EarningsSkeleton } from '@/components/ui/skeleton-group';
import { getServerSession } from '@/lib/auth/auth';
import { getEarningTransactions } from '@/lib/earnings-data';
import { prisma } from '@/lib/prisma';

export const metadata = {
  title: 'Earnings | Tamgora',
  description: 'Track your freelance earnings and export tax documents.',
};

async function EarningsSection() {
  const session = await getServerSession();
  const transactions = session?.user?.id
    ? await getEarningTransactions(session.user.id, prisma)
    : [];

  return <EarningsDashboard transactions={transactions} />;
}

export default function EarningsPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-grow container max-w-5xl mx-auto px-4 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Earnings</h1>
          <p className="text-muted-foreground mt-1">
            Track your income, filter by date range, and export tax documents.
          </p>
        </div>
        <Suspense fallback={<EarningsSkeleton />}>
          <EarningsSection />
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}
