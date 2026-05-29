import { CardSkeleton, BountySkeleton, TextSkeleton } from '@/components/skeletons/card-skeleton';

/** Skeleton for a full creator profile page */
export function CreatorProfileSkeleton() {
  return (
    <div className="animate-pulse">
      {/* Cover */}
      <div className="h-48 sm:h-64 bg-muted w-full" />
      {/* Avatar + name */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-end gap-4 -mt-12 mb-6">
          <div className="w-24 h-24 rounded-full bg-muted border-4 border-background" />
          <div className="pb-2 space-y-2 flex-1">
            <div className="h-7 bg-muted rounded w-48" />
            <div className="h-4 bg-muted rounded w-32" />
          </div>
        </div>
        {/* Bio */}
        <TextSkeleton lines={3} />
        {/* Skills */}
        <div className="flex gap-2 mt-6 flex-wrap">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-6 bg-muted rounded-full w-20" />
          ))}
        </div>
        {/* Projects grid */}
        <div className="mt-10">
          <div className="h-6 bg-muted rounded w-40 mb-6" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 3 }).map((_, i) => <CardSkeleton key={i} />)}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Skeleton for the bounties listing page */
export function BountiesPageSkeleton() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 animate-pulse">
      {/* Header */}
      <div className="h-10 bg-muted rounded w-64 mb-3" />
      <div className="h-5 bg-muted rounded w-96 mb-10" />
      {/* Filter bar */}
      <div className="flex gap-2 mb-8 flex-wrap">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-8 bg-muted rounded-full w-24" />
        ))}
      </div>
      {/* Bounty cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {Array.from({ length: 6 }).map((_, i) => <BountySkeleton key={i} />)}
      </div>
    </div>
  );
}
