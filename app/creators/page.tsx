import { Suspense } from 'react';
import type { Metadata } from 'next';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { CardSkeleton } from '@/components/skeletons/card-skeleton';
import { fetchCreatorsList } from '@/lib/streaming/chunk-data';
import { CreatorsListClient } from './creators-list-client';

export const metadata: Metadata = {
  title: 'Creator Directory | Tamgora',
  description:
    'Explore our community of world-class creators on Stellar. Filter by discipline to find the perfect talent for your project.',
};

// The directory is DB-backed and cursor-paginated; revalidate periodically so
// newly registered creators appear without a full rebuild.
export const revalidate = 60;

interface CreatorsSearchParams {
  cursor?: string;
  limit?: string;
  role?: string;
  search?: string;
  sort?: string;
}

interface CreatorsPageProps {
  // Next.js 15+ passes searchParams as a Promise.
  searchParams?: Promise<CreatorsSearchParams>;
}

async function CreatorsListSection({ searchParams }: CreatorsPageProps) {
  const params = (await searchParams) ?? {};
  // `role` is the discipline filter; cursor/limit/search/sort are served by
  // the paginated GET /api/creators endpoint (#1824).
  const creators = await fetchCreatorsList(params.role);
  return <CreatorsListClient initialCreators={creators} />;
}

function CreatorsGridSkeleton() {
  return (
    <section className="py-16 sm:py-24">
      <div className="page-container">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      </div>
    </section>
  );
}

export default function CreatorsPage({ searchParams }: CreatorsPageProps) {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />

      <main className="flex-grow">
        {/* Hero Section */}
        <section className="border-b border-border bg-muted/30 py-12 sm:py-16">
          <div className="page-container">
            <h1 className="text-4xl sm:text-5xl font-bold text-foreground mb-3">
              Creator Directory
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl">
              Explore our community of world-class creators. Filter by discipline to find the
              perfect talent for your project.
            </p>
          </div>
        </section>

        {/* RSC Streamed Creators Section */}
        <Suspense fallback={<CreatorsGridSkeleton />}>
          <CreatorsListSection searchParams={searchParams} />
        </Suspense>

        {/* CTA Section */}
        <section className="border-t border-border bg-muted/30 py-16 sm:py-24">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
              Ready to Collaborate?
            </h2>
            <p className="text-lg text-muted-foreground mb-8">
              Found the perfect creator? Reach out directly through their social profiles or contact
              us for partnership inquiries.
            </p>
            <a
              href="mailto:contact@stellar.com"
              className="inline-flex items-center justify-center px-6 py-3 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 transition-colors"
            >
              Get In Touch
            </a>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
