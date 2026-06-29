'use client';

import { useState, useRef, useEffect } from 'react';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { CreatorCard } from '@/components/creator-card';
import { disciplines } from '@/lib/creators-data';
import { CreatorCard } from '@/components/cards/creator-card';
import { creators, disciplines, getCreatorsByDiscipline } from '@/lib/services/creators-data';
import { Button } from '@/components/ui/button';
import { trpc } from '@/lib/trpc-client';
import { CardSkeleton } from '@/components/skeletons/card-skeleton';

export default function CreatorsPage() {
  const [selectedDiscipline, setSelectedDiscipline] = useState<string>('All');
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    error,
  } = trpc.creators.list.useInfiniteQuery(
    {
      take: 12,
      discipline: selectedDiscipline === 'All' ? undefined : selectedDiscipline,
    },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
    }
  );

  // Intersection Observer for infinite scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { threshold: 0.1 }
    );

    const currentRef = loadMoreRef.current;
    if (currentRef) {
      observer.observe(currentRef);
    }

    return () => {
      if (currentRef) {
        observer.unobserve(currentRef);
      }
    };
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const allCreators = data?.pages.flatMap((page) => page.creators) || [];

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />

      <main className="flex-grow">
        {/* Hero Section */}
        <section className="border-b border-border bg-muted/30 py-12 sm:py-16">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h1 className="text-4xl sm:text-5xl font-bold text-foreground mb-3">
              Creator Directory
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl">
              Explore our community of world-class creators. Filter by discipline to find the perfect talent for your project.
            </p>
          </div>
        </section>

        {/* Filter Section */}
        <section className="border-b border-border py-8 sticky top-16 bg-background/80 backdrop-blur-md z-40">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <h2 className="text-sm font-semibold text-foreground">Filter by Discipline:</h2>
              <div className="flex flex-wrap gap-2">
                {disciplines.map((discipline) => (
                  <Button
                    key={discipline}
                    variant={selectedDiscipline === discipline ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSelectedDiscipline(discipline)}
                    className={`transition-all duration-200 ease-out ${
                      selectedDiscipline === discipline ? 'scale-105 shadow-lg shadow-primary/30' : 'hover:scale-105'
                    }`}
                  >
                    {discipline}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Creators Grid */}
        <section className="py-16 sm:py-24">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            {isError ? (
              <div className="text-center py-12">
                <p className="text-lg text-red-500 mb-4">
                  Error loading creators: {error?.message}
                </p>
                <Button
                  variant="outline"
                  onClick={() => window.location.reload()}
                >
                  Retry
                </Button>
              </div>
            ) : isLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {Array.from({ length: 6 }).map((_, i) => (
                  <CardSkeleton key={i} />
                ))}
              </div>
            ) : allCreators.length > 0 ? (
              <>
                <div className="mb-8">
                  <p className="text-sm text-muted-foreground">
                    Showing {allCreators.length} creator{allCreators.length !== 1 ? 's' : ''}
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {allCreators.map((creator) => (
                    <CreatorCard key={creator.id} creator={creator} />
                  ))}
                </div>

                {/* Loading indicator for next page */}
                {isFetchingNextPage && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-6">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <CardSkeleton key={i} />
                    ))}
                  </div>
                )}

                {/* Sentinel div for IntersectionObserver */}
                {hasNextPage && (
                  <div ref={loadMoreRef} className="h-10" />
                )}
              </>
            ) : (
              <div className="text-center py-12">
                <p className="text-lg text-muted-foreground mb-4">
                  No creators found in this category.
                </p>
                <Button
                  variant="outline"
                  onClick={() => setSelectedDiscipline('All')}
                >
                  View All Creators
                </Button>
              </div>
            )}
          </div>
        </section>

        {/* CTA Section */}
        <section className="border-t border-border bg-muted/30 py-16 sm:py-24">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
              Ready to Collaborate?
            </h2>
            <p className="text-lg text-muted-foreground mb-8">
              Found the perfect creator? Reach out directly through their social profiles or contact us for partnership inquiries.
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
