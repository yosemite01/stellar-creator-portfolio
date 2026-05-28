/**
 * useCache Hook
 * React hook for cache management with rapid revisit metrics
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { CacheService, CacheMetrics, CacheOptions } from '../services/CacheService';

export interface UseCacheReturn<T> {
  // State
  data: T | null;
  loading: boolean;
  error: string | null;
  isCached: boolean;
  
  // Actions
  refresh: () => Promise<void>;
  clearCache: () => Promise<void>;
  invalidate: () => Promise<void>;
}

export interface UseCacheOptions<T> extends CacheOptions {
  key: string;
  fetcher: () => Promise<T>;
  enabled?: boolean;
  refetchOnMount?: boolean;
}

/**
 * Hook for managing cached data with automatic fetching
 */
export const useCache = <T,>(options: UseCacheOptions<T>): UseCacheReturn<T> => {
  const { key, fetcher, enabled = true, refetchOnMount = false, ...cacheOptions } = options;
  
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCached, setIsCached] = useState(false);
  
  const isMounted = useRef(true);
  const hasFetched = useRef(false);

  const fetchData = useCallback(async (forceRefresh = false) => {
    if (!enabled) return;
    
    setLoading(true);
    setError(null);

    try {
      let result: T | null = null;

      if (!forceRefresh) {
        // Try to get from cache first
        result = await CacheService.get<T>(key);
        if (result !== null && isMounted.current) {
          setData(result);
          setIsCached(true);
          setLoading(false);
          return;
        }
      }

      // Fetch fresh data
      result = await fetcher();
      
      if (result !== null && isMounted.current) {
        // Store in cache
        await CacheService.set(key, result, cacheOptions);
        setData(result);
        setIsCached(false);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      if (isMounted.current) {
        setError(errorMessage);
      }
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
    }
  }, [key, fetcher, enabled, cacheOptions]);

  const refresh = useCallback(async () => {
    await fetchData(true);
  }, [fetchData]);

  const clearCache = useCallback(async () => {
    await CacheService.remove(key);
    setIsCached(false);
  }, [key]);

  const invalidate = useCallback(async () => {
    await clearCache();
    await fetchData(true);
  }, [clearCache, fetchData]);

  useEffect(() => {
    if (enabled && (!hasFetched.current || refetchOnMount)) {
      fetchData();
      hasFetched.current = true;
    }

    return () => {
      isMounted.current = false;
    };
  }, [enabled, refetchOnMount, fetchData]);

  return {
    data,
    loading,
    error,
    isCached,
    refresh,
    clearCache,
    invalidate,
  };
};

/**
 * Hook for cache metrics
 */
export const useCacheMetrics = () => {
  const [metrics, setMetrics] = useState<CacheMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isMounted = useRef(true);

  const loadMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const metricsData = await CacheService.getMetrics();
      if (isMounted.current) {
        setMetrics(metricsData);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      if (isMounted.current) {
        setError(errorMessage);
      }
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
    }
  }, []);

  const clearAllCache = useCallback(async () => {
    try {
      await CacheService.clear();
      await loadMetrics();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
    }
  }, [loadMetrics]);

  const pruneExpired = useCallback(async () => {
    try {
      const count = await CacheService.pruneExpired();
      await loadMetrics();
      return count;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      return 0;
    }
  }, [loadMetrics]);

  const exportCache = useCallback(async (): Promise<string | null> => {
    try {
      return await CacheService.exportCache();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      return null;
    }
  }, []);

  useEffect(() => {
    loadMetrics();

    return () => {
      isMounted.current = false;
    };
  }, [loadMetrics]);

  return {
    metrics,
    loading,
    error,
    refresh: loadMetrics,
    clearAllCache,
    pruneExpired,
    exportCache,
  };
};
