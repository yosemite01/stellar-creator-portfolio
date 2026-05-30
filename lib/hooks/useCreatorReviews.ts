"use client";

import { useEffect, useState } from "react";
import { useDataLoaders } from "@/app/providers/DataLoaderProvider";

/**
 * Hook to fetch creator reviews using DataLoader
 * Automatically batches requests to prevent N+1 queries
 */
export function useCreatorReviews(creatorId: string) {
  const { creatorReviewsLoader } = useDataLoaders();
  const [data, setData] = useState<{ reviews: any[]; total: number } | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;

    creatorReviewsLoader
      .load(creatorId)
      .then((result) => {
        if (mounted) {
          setData(result);
          setError(null);
        }
      })
      .catch((err) => {
        if (mounted) {
          setError(err);
          setData(null);
        }
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [creatorId, creatorReviewsLoader]);

  return { data, loading, error };
}

/**
 * Hook to fetch creator reputation using DataLoader
 * Automatically batches requests to prevent N+1 queries
 */
export function useCreatorReputation(creatorId: string) {
  const { creatorReputationLoader } = useDataLoaders();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;

    creatorReputationLoader
      .load(creatorId)
      .then((result) => {
        if (mounted) {
          setData(result);
          setError(null);
        }
      })
      .catch((err) => {
        if (mounted) {
          setError(err);
          setData(null);
        }
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [creatorId, creatorReputationLoader]);

  return { data, loading, error };
}
