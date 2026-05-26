'use client';

import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AggregateRating } from '@/lib/services/review-service';

interface StarRatingProps {
  value: number; // 0-5, supports decimals
  max?: number;
  size?: 'sm' | 'md' | 'lg';
  interactive?: false;
  className?: string;
}

interface InteractiveStarRatingProps {
  value: number;
  max?: number;
  size?: 'sm' | 'md' | 'lg';
  interactive: true;
  onChange: (rating: number) => void;
  className?: string;
}

type RatingDisplayProps = StarRatingProps | InteractiveStarRatingProps;

const sizeMap = { sm: 14, md: 18, lg: 24 };

export function StarRating(props: RatingDisplayProps) {
  const { value, max = 5, size = 'md', className } = props;
  const px = sizeMap[size];

  return (
    <div
      className={cn('flex items-center gap-0.5', className)}
      role="img"
      aria-label={`${value} out of ${max} stars`}
    >
      {Array.from({ length: max }, (_, i) => {
        const filled = value >= i + 1;
        const partial = !filled && value > i;
        const fillPercent = partial ? Math.round((value - i) * 100) : 0;

        if (props.interactive) {
          return (
            <button
              key={i}
              type="button"
              onClick={() => props.onChange(i + 1)}
              className="focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
              aria-label={`Rate ${i + 1} star${i + 1 !== 1 ? 's' : ''}`}
            >
              <Star
                size={px}
                className={cn(
                  'transition-colors',
                  filled || (partial && fillPercent > 50)
                    ? 'fill-yellow-400 text-yellow-400'
                    : 'fill-muted text-muted-foreground'
                )}
              />
            </button>
          );
        }

        return (
          <span key={i} className="relative inline-block" style={{ width: px, height: px }}>
            {/* Background star */}
            <Star size={px} className="fill-muted text-muted-foreground" />
            {/* Filled overlay */}
            {(filled || partial) && (
              <span
                className="absolute inset-0 overflow-hidden"
                style={{ width: filled ? '100%' : `${fillPercent}%` }}
              >
                <Star size={px} className="fill-yellow-400 text-yellow-400" />
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}

interface AggregateRatingDisplayProps {
  aggregate: AggregateRating;
  className?: string;
}

export function AggregateRatingDisplay({ aggregate, className }: AggregateRatingDisplayProps) {
  const { average, total, breakdown } = aggregate;

  return (
    <div className={cn('flex flex-col sm:flex-row gap-6 items-start sm:items-center', className)}>
      {/* Big number */}
      <div className="text-center min-w-[80px]">
        <div className="text-5xl font-bold text-foreground">{average.toFixed(1)}</div>
        <StarRating value={average} size="sm" className="justify-center mt-1" />
        <p className="text-xs text-muted-foreground mt-1">{total} review{total !== 1 ? 's' : ''}</p>
      </div>

      {/* Breakdown bars */}
      <div className="flex-1 w-full space-y-1.5">
        {([5, 4, 3, 2, 1] as const).map((star) => {
          const count = breakdown[star] ?? 0;
          const pct = total > 0 ? Math.round((count / total) * 100) : 0;
          return (
            <div key={star} className="flex items-center gap-2 text-sm">
              <span className="w-4 text-right text-muted-foreground">{star}</span>
              <Star size={12} className="fill-yellow-400 text-yellow-400 shrink-0" />
              <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-yellow-400 rounded-full transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="w-8 text-right text-muted-foreground text-xs">{pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
