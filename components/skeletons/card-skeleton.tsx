'use client';

export function CardSkeleton() {
  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden animate-pulse">
      <div className="aspect-video bg-muted" />
      <div className="p-6 space-y-4">
        <div className="h-6 bg-muted rounded w-3/4" />
        <div className="space-y-2">
          <div className="h-4 bg-muted rounded w-full" />
          <div className="h-4 bg-muted rounded w-5/6" />
        </div>
        <div className="flex gap-2 pt-2">
          <div className="h-8 bg-muted rounded px-3 w-20" />
          <div className="h-8 bg-muted rounded px-3 w-20" />
        </div>
        <div className="h-10 bg-muted rounded w-full" />
      </div>
    </div>
  );
}

export function CardSkeletonGrid({ count = 3 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}

export function TextSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2 animate-pulse">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="h-4 bg-muted rounded w-full"
          style={{
            width: i === lines - 1 ? '75%' : '100%',
          }}
        />
      ))}
    </div>
  );
}

export function BountySkeleton() {
  return (
    <div className="bg-card border border-border rounded-lg p-6 animate-pulse space-y-4">
      <div className="flex justify-between items-start">
        <div className="flex-1">
          <div className="h-6 bg-muted rounded w-3/4 mb-2" />
          <div className="h-4 bg-muted rounded w-1/2" />
        </div>
        <div className="h-8 bg-muted rounded w-24" />
      </div>
      <div className="space-y-2">
        <div className="h-4 bg-muted rounded w-full" />
        <div className="h-4 bg-muted rounded w-full" />
      </div>
      <div className="flex gap-2 pt-2">
        <div className="h-6 bg-muted rounded px-3 w-20" />
        <div className="h-6 bg-muted rounded px-3 w-20" />
      </div>
    </div>
  );
}
