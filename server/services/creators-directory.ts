/**
 * Creators Directory DB Service (Issue #1824)
 *
 * Provides database-backed creator listing, stable cursor pagination under concurrent inserts,
 * multi-attribute filtering (discipline, search, skills, rating, verification),
 * and in-memory TTL caching.
 */

import { prisma as defaultPrisma } from '@/lib/prisma';
import { creatorCardSelect, toCreator } from '@/server/api/creator-mapper';
import { creators as fallbackCreators, type Creator } from '@/lib/services/creators-data';
import type { Prisma } from '@prisma/client';

export interface CreatorListParams {
  take?: number;
  cursor?: string;
  discipline?: string;
  search?: string;
  skills?: string[];
  minRating?: number;
  verified?: boolean;
}

export interface CreatorListResult {
  creators: Creator[];
  nextCursor: string | null;
  hasNextPage: boolean;
  total: number;
}

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000; // 60 seconds
const cache = new Map<string, CacheEntry<any>>();

export function encodeCursor(id: string, createdAt: Date): string {
  const payload = JSON.stringify({ id, createdAt: createdAt.toISOString() });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

export function decodeCursor(cursorStr: string): { id: string; createdAt: Date } | null {
  try {
    const raw = Buffer.from(cursorStr, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);
    if (!parsed.id || !parsed.createdAt) return null;
    return { id: parsed.id, createdAt: new Date(parsed.createdAt) };
  } catch {
    return null;
  }
}

export function invalidateCreatorsCache(): void {
  cache.clear();
}

/**
 * DB-backed listing with stable cursor pagination and filters.
 *
 * Pagination stability:
 * Uses composite cursor `(createdAt, id)` with `WHERE (createdAt < cursor.createdAt) OR (createdAt = cursor.createdAt AND id < cursor.id)`
 * and `ORDER BY createdAt DESC, id DESC`.
 * When new creators are inserted with newer timestamps, they are strictly excluded
 * from subsequent page queries, avoiding duplicates or skipping.
 */
export async function listCreatorsFromDB(
  params: CreatorListParams = {},
  client: any = defaultPrisma,
): Promise<CreatorListResult> {
  const take = Math.min(Math.max(params.take ?? 12, 1), 100);
  const cacheKey = JSON.stringify({ ...params, take });

  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const where: Prisma.CreatorProfileWhereInput = {};

  if (params.discipline && params.discipline !== 'All') {
    where.discipline = { equals: params.discipline, mode: 'insensitive' };
  }

  if (params.search) {
    const s = params.search.trim();
    if (s.length > 0) {
      where.OR = [
        { displayName: { contains: s, mode: 'insensitive' } },
        { bio: { contains: s, mode: 'insensitive' } },
      ];
    }
  }

  if (params.skills && params.skills.length > 0) {
    where.skills = { hasSome: params.skills };
  }

  if (params.minRating !== undefined && params.minRating > 0) {
    where.rating = { gte: params.minRating };
  }

  if (params.verified !== undefined) {
    where.verified = params.verified;
  }

  // Count total matching profiles for this filter (independent of cursor)
  const total = await client.creatorProfile.count({ where });

  // Apply stable compound cursor
  if (params.cursor) {
    const decoded = decodeCursor(params.cursor);
    if (decoded) {
      where.AND = [
        ...(where.AND ? (Array.isArray(where.AND) ? where.AND : [where.AND]) : []),
        {
          OR: [
            { createdAt: { lt: decoded.createdAt } },
            {
              AND: [
                { createdAt: { equals: decoded.createdAt } },
                { id: { lt: decoded.id } },
              ],
            },
          ],
        },
      ];
    } else {
      // Fallback if raw ID cursor passed
      where.AND = [
        ...(where.AND ? (Array.isArray(where.AND) ? where.AND : [where.AND]) : []),
        { id: { lt: params.cursor } },
      ];
    }
  }

  const profiles = await client.creatorProfile.findMany({
    take: take + 1,
    where,
    select: creatorCardSelect,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });

  const hasNextPage = profiles.length > take;
  if (hasNextPage) {
    profiles.pop();
  }

  const nextCursor =
    hasNextPage && profiles.length > 0
      ? encodeCursor(profiles[profiles.length - 1].id, profiles[profiles.length - 1].createdAt)
      : null;

  const creators = profiles.map(toCreator);

  const result: CreatorListResult = {
    creators,
    nextCursor,
    hasNextPage,
    total,
  };

  cache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });

  return result;
}

/**
 * Looks up a creator by ID from the database with fallback to legacy static data.
 */
export async function getCreatorByIdFromDB(
  id: string,
  client: any = defaultPrisma,
): Promise<Creator | null> {
  const cacheKey = `creator:id:${id}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  try {
    const profile = await client.creatorProfile.findFirst({
      where: {
        OR: [{ id }, { userId: id }],
      },
      select: {
        ...creatorCardSelect,
        userId: true,
        githubUrl: true,
        figmaUrl: true,
      },
    });

    if (profile) {
      const projects = await client.project.findMany({
        where: { creatorId: profile.userId },
        select: {
          id: true,
          title: true,
          description: true,
          category: true,
          tags: true,
          year: true,
          link: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      const creator = {
        ...toCreator(profile),
        projects: projects.map((p: any) => ({
          id: p.id,
          title: p.title,
          description: p.description,
          category: p.category,
          image: '/projects/default.jpg',
          link: p.link ?? undefined,
          tags: p.tags,
          year: p.year,
        })),
      };

      cache.set(cacheKey, { data: creator, expiresAt: Date.now() + CACHE_TTL_MS });
      return creator;
    }
  } catch {
    // If DB is offline or throws, fallback to static demo data below
  }

  // Graceful fallback to static data if not present in DB
  const fallback = fallbackCreators.find((c) => c.id === id);
  if (fallback) {
    return fallback;
  }

  return null;
}
