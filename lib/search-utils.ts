import { prisma } from '@/lib/prisma';

export interface SearchFilters {
  query?: string;
  discipline?: string;
  skills?: string[];
  minRate?: number;
  maxRate?: number;
  availability?: 'available' | 'limited' | 'unavailable';
  minRating?: number;
  limit?: number;
  offset?: number;
}

export interface BountyFilters {
  query?: string;
  difficulty?: string;
  category?: string;
  minBudget?: number;
  maxBudget?: number;
  status?: string;
  tags?: string[];
  limit?: number;
  offset?: number;
}

/**
 * Advanced search for creators with multiple filters (#1760: unified on Prisma).
 */
export async function searchCreators(filters: SearchFilters) {
  const limit = filters.limit || 10;
  const offset = filters.offset || 0;

  const where: Record<string, any> = {};

  if (filters.query) {
    where.OR = [
      { displayName: { contains: filters.query, mode: 'insensitive' } },
      { bio: { contains: filters.query, mode: 'insensitive' } },
    ];
  }

  if (filters.discipline) {
    where.discipline = { equals: filters.discipline, mode: 'insensitive' };
  }

  if (filters.skills && filters.skills.length > 0) {
    where.skills = { hasSome: filters.skills };
  }

  if (filters.minRating !== undefined) {
    where.rating = { gte: filters.minRating };
  }

  try {
    const [data, total] = await Promise.all([
      prisma.creatorProfile.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
              image: true,
            },
          },
        },
        orderBy: [{ rating: 'desc' }, { completedProjects: 'desc' }],
        skip: offset,
        take: limit,
      }),
      prisma.creatorProfile.count({ where }),
    ]);

    const formatted = data.map((c: any) => ({
      ...c,
      title: c.displayName,
      users: c.user,
    }));

    return { data: formatted, error: null, count: total, limit, offset };
  } catch (error: any) {
    return { data: [], error, count: 0, limit, offset };
  }
}

/**
 * Advanced search for bounties with multiple filters (#1760: unified on Prisma).
 */
export async function searchBounties(filters: BountyFilters) {
  const limit = filters.limit || 10;
  const offset = filters.offset || 0;

  const where: Record<string, any> = {};

  if (filters.query) {
    where.OR = [
      { title: { contains: filters.query, mode: 'insensitive' } },
      { description: { contains: filters.query, mode: 'insensitive' } },
    ];
  }

  if (filters.difficulty) {
    where.difficulty = filters.difficulty.toLowerCase();
  }

  if (filters.category) {
    where.category = { equals: filters.category, mode: 'insensitive' };
  }

  if (filters.minBudget !== undefined || filters.maxBudget !== undefined) {
    where.budget = {};
    if (filters.minBudget !== undefined) where.budget.gte = filters.minBudget;
    if (filters.maxBudget !== undefined) where.budget.lte = filters.maxBudget;
  }

  if (filters.status) {
    where.status = filters.status.toUpperCase();
  }

  if (filters.tags && filters.tags.length > 0) {
    where.tags = { hasSome: filters.tags };
  }

  try {
    const [data, total] = await Promise.all([
      prisma.bounty.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      prisma.bounty.count({ where }),
    ]);

    return { data, error: null, count: total, limit, offset };
  } catch (error: any) {
    return { data: [], error, count: 0, limit, offset };
  }
}

/**
 * Get search suggestions for autocomplete (#1760: unified on Prisma).
 */
export async function getCreatorSearchSuggestions(query: string) {
  if (query.length < 2) {
    return [];
  }

  try {
    const creators = await prisma.creatorProfile.findMany({
      where: {
        OR: [
          { displayName: { contains: query, mode: 'insensitive' } },
          { bio: { contains: query, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        displayName: true,
        bio: true,
        skills: true,
      },
      take: 5,
    });

    return creators.map((c) => ({
      id: c.id,
      title: c.displayName,
      bio: c.bio,
      skills: c.skills,
    }));
  } catch {
    return [];
  }
}

/**
 * Parse search operators (e.g., "discipline:design skill:figma")
 */
export function parseSearchOperators(query: string): SearchFilters {
  const filters: SearchFilters = {};
  const parts = query.split(' ');
  const textParts: string[] = [];

  for (const part of parts) {
    if (part.includes(':')) {
      const [key, value] = part.split(':');

      switch (key) {
        case 'discipline':
          filters.discipline = value;
          break;
        case 'skill':
          filters.skills = filters.skills || [];
          filters.skills.push(value);
          break;
        case 'minrate':
          filters.minRate = parseInt(value, 10);
          break;
        case 'maxrate':
          filters.maxRate = parseInt(value, 10);
          break;
        case 'rating':
          filters.minRating = parseFloat(value);
          break;
        case 'availability':
          filters.availability = value as 'available' | 'limited' | 'unavailable';
          break;
        default:
          textParts.push(part);
      }
    } else {
      textParts.push(part);
    }
  }

  filters.query = textParts.join(' ');
  return filters;
}
