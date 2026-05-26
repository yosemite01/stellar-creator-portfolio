'use client';

import { useRouter } from 'next/navigation';
import { bounties } from '@/lib/creators-data';
import { Button } from '@/components/ui/button';
import { ArrowRight, Clock, DollarSign, Zap } from 'lucide-react';

export function FeaturedBounties() {
  const router = useRouter();
  const featured = bounties.slice(0, 3);

  return (
    <section className="py-16 sm:py-24 border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="flex items-start justify-between mb-12 sm:mb-16">
          <div>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-foreground mb-3">
              Hot Bounties
            </h2>
            <p className="text-muted-foreground max-w-2xl">
              Explore the latest opportunities from leading brands
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => router.push('/bounties')}
            className="hidden sm:inline-flex gap-2"
          >
            View All
            <ArrowRight size={16} />
          </Button>
        </div>

        {/* Bounties Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {featured.map((bounty) => (
            <div
              key={bounty.id}
              onClick={() => router.push('/bounties')}
              className="group bg-card border border-border rounded-lg p-6 hover:shadow-lg transition-all duration-300 hover:-translate-y-1 cursor-pointer"
            >
              {/* Header */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <h3 className="text-lg font-bold text-foreground mb-2 line-clamp-2 group-hover:text-primary transition-colors">
                    {bounty.title}
                  </h3>
                  <span className="inline-block text-xs font-semibold px-2 py-1 bg-primary/15 text-primary rounded-full">
                    {bounty.difficulty}
                  </span>
                </div>
              </div>

              {/* Description */}
              <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
                {bounty.description}
              </p>

              {/* Meta Information */}
              <div className="space-y-2 mb-4 py-4 border-y border-border/50">
                <div className="flex items-center gap-2">
                  <DollarSign size={16} className="text-accent" />
                  <span className="text-sm font-semibold text-foreground">
                    ${bounty.budget.toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock size={16} className="text-accent" />
                  <span className="text-sm text-muted-foreground">
                    {Math.ceil(
                      (bounty.deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
                    )}{' '}
                    days left
                  </span>
                </div>
              </div>

              {/* Tags */}
              <div className="flex flex-wrap gap-2 mb-4">
                {bounty.tags.slice(0, 2).map((tag) => (
                  <span
                    key={tag}
                    className="text-xs px-2 py-1 bg-secondary/50 text-secondary-foreground rounded"
                  >
                    {tag}
                  </span>
                ))}
                {bounty.tags.length > 2 && (
                  <span className="text-xs px-2 py-1 text-muted-foreground">
                    +{bounty.tags.length - 2} more
                  </span>
                )}
              </div>

              {/* CTA */}
              <Button
                variant="ghost"
                className="w-full text-primary hover:text-primary hover:bg-primary/10"
              >
                View Details
                <ArrowRight size={16} className="ml-2" />
              </Button>
            </div>
          ))}
        </div>

        {/* Mobile View All Button */}
        <div className="sm:hidden">
          <Button
            className="w-full"
            onClick={() => router.push('/bounties')}
          >
            View All Bounties
            <ArrowRight size={16} className="ml-2" />
          </Button>
        </div>
      </div>
    </section>
  );
}
