'use client';

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { CreatorCard } from '@/components/cards/creator-card';
import { Button } from '@/components/ui/button';
import { CardSkeleton } from '@/components/skeletons/card-skeleton';
import type { Creator } from '@/lib/services/creators-data';

const DISCIPLINES = [
  'All',
  'Design',
  'Development',
  'Writing',
  'Video',
  'Music',
  'Photography',
  'Marketing',
] as const;

interface CreatorsListClientProps {
  initialCreators: Creator[];
}

export function CreatorsListClient({ initialCreators }: CreatorsListClientProps) {
  const [selectedDiscipline, setSelectedDiscipline] = useState<string>('All');
  const [visibleCount, setVisibleCount] = useState<number>(12);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Filter creators by discipline
  const filteredCreators = useMemo(() => {
    if (selectedDiscipline === 'All') return initialCreators;
    return initialCreators.filter(
      (c) => c.discipline.toLowerCase() === selectedDiscipline.toLowerCase(),
    );
  }, [initialCreators, selectedDiscipline]);

  const displayedCreators = useMemo(() => {
    return filteredCreators.slice(0, visibleCount);
  }, [filteredCreators, visibleCount]);

  const hasNextPage = displayedCreators.length < filteredCreators.length;

  const loadMore = useCallback(() => {
    if (hasNextPage && !isLoadingMore) {
      setIsLoadingMore(true);
      setTimeout(() => {
        setVisibleCount((prev) => prev + 6);
        setIsLoadingMore(false);
      }, 250);
    }
  }, [hasNextPage, isLoadingMore]);

  // Intersection Observer for infinite scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isLoadingMore) {
          loadMore();
        }
      },
      { threshold: 0.1 },
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
  }, [hasNextPage, isLoadingMore, loadMore]);

  return (
    <>
      {/* Filter Section */}
      <section className="border-b border-border py-8 sticky top-16 bg-background/80 backdrop-blur-md z-40">
        <div className="page-container">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <h2 className="text-sm font-semibold text-foreground">Filter by Discipline:</h2>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter creators by discipline">
              {DISCIPLINES.map((discipline) => (
                <Button
                  key={discipline}
                  variant={selectedDiscipline === discipline ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => {
                    setSelectedDiscipline(discipline);
                    setVisibleCount(12);
                  }}
                  aria-pressed={selectedDiscipline === discipline}
                  className={`transition-all duration-200 ease-out ${
                    selectedDiscipline === discipline
                      ? 'scale-105 shadow-lg shadow-primary/30'
                      : 'hover:scale-105'
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
        <div className="page-container">
          {displayedCreators.length > 0 ? (
            <>
              <div className="mb-8 flex items-center justify-between">
                <p className="text-sm text-muted-foreground" aria-live="polite">
                  Showing {displayedCreators.length} of {filteredCreators.length} creator
                  {filteredCreators.length !== 1 ? 's' : ''}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {displayedCreators.map((creator) => (
                  <CreatorCard key={creator.id} creator={creator} />
                ))}
              </div>

              {/* Loading indicator for next page */}
              {isLoadingMore && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-6">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <CardSkeleton key={i} />
                  ))}
                </div>
              )}

              {/* Sentinel div for IntersectionObserver */}
              {hasNextPage && <div ref={loadMoreRef} className="h-10" aria-hidden="true" />}
            </>
          ) : (
            <div className="text-center py-12">
              <p className="text-lg font-medium text-foreground mb-1">
                No creators here yet
              </p>
              <p className="text-sm text-muted-foreground mb-4">
                {selectedDiscipline === 'All'
                  ? 'No creators have joined yet — check back soon.'
                  : `Nobody in the "${selectedDiscipline}" category has joined yet — try browsing all creators instead.`}
              </p>
              {selectedDiscipline !== 'All' && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setSelectedDiscipline('All');
                    setVisibleCount(12);
                  }}
                >
                  View All Creators
                </Button>
              )}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
