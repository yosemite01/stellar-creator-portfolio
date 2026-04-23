'use client';

import { useEffect, useState } from 'react';
import type { ApiResponse, CreatorReputationPayload } from '@/lib/api-models';
import { isApiSuccess } from '@/lib/api-models';
import { ReviewList } from '@/components/review-list';
import { ErrorAlert } from '@/components/error-alert';
import { Badge } from '@/components/ui/badge';
import { CheckCircle } from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

function StarRow({ value, max = 5 }: { value: number; max?: number }) {
  const rounded = Math.round(value);
  return (
    <div className="flex gap-0.5" aria-label={`${value.toFixed(2)} out of ${max} stars`}>
      {Array.from({ length: max }, (_, i) => (
        <span
          key={i}
          className={i < rounded ? 'text-amber-500' : 'text-muted-foreground/40'}
          aria-hidden
        >
          ★
        </span>
      ))}
    </div>
  );
}

function Histogram({
  aggregation,
}: {
  aggregation: CreatorReputationPayload['aggregation'];
}) {
  const total = aggregation.totalReviews;
  if (total === 0) return null;

  const rows: { label: string; count: number }[] = [
    { label: '5 stars', count: aggregation.stars5 },
    { label: '4 stars', count: aggregation.stars4 },
    { label: '3 stars', count: aggregation.stars3 },
    { label: '2 stars', count: aggregation.stars2 },
    { label: '1 star', count: aggregation.stars1 },
  ];

  return (
    <div className="space-y-2 mt-6" aria-label="Rating distribution">
      <p className="text-sm font-semibold text-foreground">Rating breakdown</p>
      {rows.map((row) => {
        const pct = Math.round((row.count / total) * 100);
        return (
          <div key={row.label} className="flex items-center gap-3 text-sm">
            <span className="w-16 text-muted-foreground shrink-0">{row.label}</span>
            <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="w-10 text-right tabular-nums text-muted-foreground">{row.count}</span>
          </div>
        );
      })}
    </div>
  );
}

export function CreatorReputation({ creatorId }: { creatorId: string }) {
  const [payload, setPayload] = useState<CreatorReputationPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(
          `${API_BASE}/api/creators/${encodeURIComponent(creatorId)}/reputation`,
          { headers: { Accept: 'application/json' } },
        );
        if (!res.ok) {
          if (!cancelled) setError('Failed to load reviews');
          return;
        }
        const body = (await res.json()) as ApiResponse<CreatorReputationPayload>;
        if (cancelled) return;
        if (isApiSuccess(body) && body.data.aggregation.totalReviews > 0) {
          setPayload(body.data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError('Failed to load reviews');
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [creatorId]);

  if (error) {
    return (
      <section className="border-b border-border bg-muted/20 py-12">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-bold text-foreground mb-8">Client reviews</h2>
          <ErrorAlert message={error} onDismiss={() => setError(null)} />
        </div>
      </section>
    );
  }

  if (!payload) {
    return null;
  }

  const { aggregation, recentReviews } = payload;

  return (
    <section className="border-b border-border bg-muted/20 py-12">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center gap-3 mb-2">
          <h2 className="text-2xl font-bold text-foreground">Client reviews</h2>
          {aggregation.isVerified && (
            <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 px-3 py-1 gap-1.5 rounded-full hover:bg-emerald-500/15 transition-colors">
              <CheckCircle size={14} className="fill-emerald-600/10" />
              Verified Creator
            </Badge>
          )}
        </div>
        <p className="text-muted-foreground mb-8">
          Ratings from verified clients who worked with this creator.
        </p>

        <div className="bg-card border border-border rounded-xl p-6 sm:p-8">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8">
            <div className="text-center sm:text-left">
              <div className="text-4xl font-bold text-primary tabular-nums">
                {aggregation.averageRating.toFixed(2)}
              </div>
              <div className="text-sm text-muted-foreground">out of 5</div>
            </div>
            <div className="flex flex-col gap-2">
              <StarRow value={aggregation.averageRating} />
              <p className="text-sm text-muted-foreground">
                Based on {aggregation.totalReviews}{' '}
                {aggregation.totalReviews === 1 ? 'review' : 'reviews'}
              </p>
            </div>
          </div>

          <Histogram aggregation={aggregation} />

          <div className="mt-10">
            <ReviewList reviews={recentReviews} />
          </div>
        </div>
      </div>
    </section>
  );
}
