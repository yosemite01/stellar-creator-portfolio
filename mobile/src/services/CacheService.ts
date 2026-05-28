/**
 * CacheService - Async Storage Caching System
 * Provides robust caching capabilities for rapid revisit metrics
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export interface CacheEntry<T = any> {
  data: T;
  timestamp: number;
  expiresAt: number | null;
  accessCount: number;
  lastAccessed: number;
}

export interface CacheMetrics {
  totalEntries: number;
  totalSize: number;
  hitRate: number;
  missRate: number;
  averageAccessTime: number;
  mostAccessed: Array<{ key: string; count: number }>;
}

export interface CacheOptions {
  ttl?: number; // Time to live in milliseconds
  compress?: boolean;
  encrypt?: boolean;
}

export class CacheService {
  private static readonly CACHE_PREFIX = '@cache:';
  private static readonly METRICS_KEY = '@cache:metrics';
  private static readonly MAX_CACHE_SIZE = 50 * 1024 * 1024; // 50MB
  
  private static metrics = {
    hits: 0,
    misses: 0,
    totalAccessTime: 0,
    accessCount: 0,
  };

  /**
   * Set cache entry with optional TTL
   */
  static async set<T>(
    key: string,
    data: T,
    options: CacheOptions = {}
  ): Promise<boolean> {
    try {
      const startTime = Date.now();
      const cacheKey = this.getCacheKey(key);
      
      const entry: CacheEntry<T> = {
        data,
        timestamp: Date.now(),
        expiresAt: options.ttl ? Date.now() + options.ttl : null,
        accessCount: 0,
        lastAccessed: Date.now(),
      };

      await AsyncStorage.setItem(cacheKey, JSON.stringify(entry));
      
      // Update metrics
      await this.updateMetrics('set', Date.now() - startTime);
      
      return true;
    } catch (error) {
      console.error('CacheService.set error:', error);
      return false;
    }
  }

  /**
   * Get cache entry
   */
  static async get<T>(key: string): Promise<T | null> {
    try {
      const startTime = Date.now();
      const cacheKey = this.getCacheKey(key);
      
      const cached = await AsyncStorage.getItem(cacheKey);
      
      if (!cached) {
        this.metrics.misses++;
        await this.updateMetrics('miss', Date.now() - startTime);
        return null;
      }

      const entry: CacheEntry<T> = JSON.parse(cached);

      // Check expiration
      if (entry.expiresAt && entry.expiresAt < Date.now()) {
        await this.remove(key);
        this.metrics.misses++;
        await this.updateMetrics('miss', Date.now() - startTime);
        return null;
      }

      // Update access metrics
      entry.accessCount++;
      entry.lastAccessed = Date.now();
      await AsyncStorage.setItem(cacheKey, JSON.stringify(entry));

      this.metrics.hits++;
      await this.updateMetrics('hit', Date.now() - startTime);

      return entry.data;
    } catch (error) {
      console.error('CacheService.get error:', error);
      this.metrics.misses++;
      return null;
    }
  }

  /**
   * Get cache entry with metadata
   */
  static async getWithMetadata<T>(key: string): Promise<CacheEntry<T> | null> {
    try {
      const cacheKey = this.getCacheKey(key);
      const cached = await AsyncStorage.getItem(cacheKey);
      
      if (!cached) {
        return null;
      }

      const entry: CacheEntry<T> = JSON.parse(cached);

      // Check expiration
      if (entry.expiresAt && entry.expiresAt < Date.now()) {
        await this.remove(key);
        return null;
      }

      return entry;
    } catch (error) {
      console.error('CacheService.getWithMetadata error:', error);
      return null;
    }
  }

  /**
   * Check if cache entry exists and is valid
   */
  static async has(key: string): Promise<boolean> {
    try {
      const cacheKey = this.getCacheKey(key);
      const cached = await AsyncStorage.getItem(cacheKey);
      
      if (!cached) {
        return false;
      }

      const entry: CacheEntry = JSON.parse(cached);

      // Check expiration
      if (entry.expiresAt && entry.expiresAt < Date.now()) {
        await this.remove(key);
        return false;
      }

      return true;
    } catch (error) {
      console.error('CacheService.has error:', error);
      return false;
    }
  }

  /**
   * Remove cache entry
   */
  static async remove(key: string): Promise<boolean> {
    try {
      const cacheKey = this.getCacheKey(key);
      await AsyncStorage.removeItem(cacheKey);
      return true;
    } catch (error) {
      console.error('CacheService.remove error:', error);
      return false;
    }
  }

  /**
   * Clear all cache entries
   */
  static async clear(): Promise<boolean> {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const cacheKeys = keys.filter(key => key.startsWith(this.CACHE_PREFIX));
      await AsyncStorage.multiRemove(cacheKeys);
      
      // Reset metrics
      this.metrics = {
        hits: 0,
        misses: 0,
        totalAccessTime: 0,
        accessCount: 0,
      };
      
      return true;
    } catch (error) {
      console.error('CacheService.clear error:', error);
      return false;
    }
  }

  /**
   * Get all cache keys
   */
  static async getAllKeys(): Promise<string[]> {
    try {
      const keys = await AsyncStorage.getAllKeys();
      return keys
        .filter(key => key.startsWith(this.CACHE_PREFIX))
        .map(key => key.replace(this.CACHE_PREFIX, ''));
    } catch (error) {
      console.error('CacheService.getAllKeys error:', error);
      return [];
    }
  }

  /**
   * Get cache size in bytes
   */
  static async getCacheSize(): Promise<number> {
    try {
      const keys = await this.getAllKeys();
      let totalSize = 0;

      for (const key of keys) {
        const cacheKey = this.getCacheKey(key);
        const value = await AsyncStorage.getItem(cacheKey);
        if (value) {
          // Calculate size in bytes (each character is ~2 bytes in UTF-16)
          totalSize += value.length * 2;
        }
      }

      return totalSize;
    } catch (error) {
      console.error('CacheService.getCacheSize error:', error);
      return 0;
    }
  }

  /**
   * Get cache metrics
   */
  static async getMetrics(): Promise<CacheMetrics> {
    try {
      const keys = await this.getAllKeys();
      const totalSize = await this.getCacheSize();
      
      // Get most accessed entries
      const accessCounts: Array<{ key: string; count: number }> = [];
      
      for (const key of keys) {
        const entry = await this.getWithMetadata(key);
        if (entry) {
          accessCounts.push({ key, count: entry.accessCount });
        }
      }

      accessCounts.sort((a, b) => b.count - a.count);
      const mostAccessed = accessCounts.slice(0, 10);

      const totalRequests = this.metrics.hits + this.metrics.misses;
      const hitRate = totalRequests > 0 ? (this.metrics.hits / totalRequests) * 100 : 0;
      const missRate = totalRequests > 0 ? (this.metrics.misses / totalRequests) * 100 : 0;
      const averageAccessTime = this.metrics.accessCount > 0 
        ? this.metrics.totalAccessTime / this.metrics.accessCount 
        : 0;

      return {
        totalEntries: keys.length,
        totalSize,
        hitRate,
        missRate,
        averageAccessTime,
        mostAccessed,
      };
    } catch (error) {
      console.error('CacheService.getMetrics error:', error);
      return {
        totalEntries: 0,
        totalSize: 0,
        hitRate: 0,
        missRate: 0,
        averageAccessTime: 0,
        mostAccessed: [],
      };
    }
  }

  /**
   * Prune expired entries
   */
  static async pruneExpired(): Promise<number> {
    try {
      const keys = await this.getAllKeys();
      let prunedCount = 0;

      for (const key of keys) {
        const entry = await this.getWithMetadata(key);
        if (!entry) {
          prunedCount++;
        }
      }

      return prunedCount;
    } catch (error) {
      console.error('CacheService.pruneExpired error:', error);
      return 0;
    }
  }

  /**
   * Prune least recently used entries to free space
   */
  static async pruneLRU(targetSize: number): Promise<number> {
    try {
      const keys = await this.getAllKeys();
      const entries: Array<{ key: string; lastAccessed: number }> = [];

      for (const key of keys) {
        const entry = await this.getWithMetadata(key);
        if (entry) {
          entries.push({ key, lastAccessed: entry.lastAccessed });
        }
      }

      // Sort by last accessed (oldest first)
      entries.sort((a, b) => a.lastAccessed - b.lastAccessed);

      let currentSize = await this.getCacheSize();
      let prunedCount = 0;

      for (const entry of entries) {
        if (currentSize <= targetSize) {
          break;
        }

        const cacheKey = this.getCacheKey(entry.key);
        const value = await AsyncStorage.getItem(cacheKey);
        if (value) {
          const entrySize = value.length * 2; // UTF-16 encoding
          await this.remove(entry.key);
          currentSize -= entrySize;
          prunedCount++;
        }
      }

      return prunedCount;
    } catch (error) {
      console.error('CacheService.pruneLRU error:', error);
      return 0;
    }
  }

  /**
   * Get or set cache entry (cache-aside pattern)
   */
  static async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    options: CacheOptions = {}
  ): Promise<T | null> {
    try {
      // Try to get from cache
      const cached = await this.get<T>(key);
      if (cached !== null) {
        return cached;
      }

      // Generate data
      const data = await factory();
      
      // Store in cache
      await this.set(key, data, options);
      
      return data;
    } catch (error) {
      console.error('CacheService.getOrSet error:', error);
      return null;
    }
  }

  /**
   * Batch get multiple cache entries
   */
  static async multiGet<T>(keys: string[]): Promise<Map<string, T | null>> {
    const results = new Map<string, T | null>();

    for (const key of keys) {
      const value = await this.get<T>(key);
      results.set(key, value);
    }

    return results;
  }

  /**
   * Batch set multiple cache entries
   */
  static async multiSet(
    entries: Array<{ key: string; data: any; options?: CacheOptions }>
  ): Promise<boolean> {
    try {
      for (const entry of entries) {
        await this.set(entry.key, entry.data, entry.options);
      }
      return true;
    } catch (error) {
      console.error('CacheService.multiSet error:', error);
      return false;
    }
  }

  /**
   * Export cache data
   */
  static async exportCache(): Promise<string | null> {
    try {
      const keys = await this.getAllKeys();
      const cacheData: Record<string, any> = {};

      for (const key of keys) {
        const entry = await this.getWithMetadata(key);
        if (entry) {
          cacheData[key] = entry;
        }
      }

      return JSON.stringify(cacheData, null, 2);
    } catch (error) {
      console.error('CacheService.exportCache error:', error);
      return null;
    }
  }

  /**
   * Import cache data
   */
  static async importCache(jsonString: string): Promise<boolean> {
    try {
      const cacheData = JSON.parse(jsonString);

      for (const [key, entry] of Object.entries(cacheData)) {
        const cacheKey = this.getCacheKey(key);
        await AsyncStorage.setItem(cacheKey, JSON.stringify(entry));
      }

      return true;
    } catch (error) {
      console.error('CacheService.importCache error:', error);
      return false;
    }
  }

  /**
   * Private: Get cache key with prefix
   */
  private static getCacheKey(key: string): string {
    return `${this.CACHE_PREFIX}${key}`;
  }

  /**
   * Private: Update metrics
   */
  private static async updateMetrics(
    type: 'hit' | 'miss' | 'set',
    accessTime: number
  ): Promise<void> {
    this.metrics.totalAccessTime += accessTime;
    this.metrics.accessCount++;
  }
}
