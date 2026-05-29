'use client';

import { Suspense } from 'react';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { BountiesPageSkeleton } from '@/components/ui/skeleton-group';
import BountiesClient from './BountiesClient';
import { bounties } from '@/lib/creators-data';

export default function BountiesPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-grow">
        <Suspense fallback={<BountiesPageSkeleton />}>
          <BountiesClient bounties={bounties} />
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}
