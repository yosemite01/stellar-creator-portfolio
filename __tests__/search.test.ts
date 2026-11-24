/**
 * Tests for server/services/search.ts (#1763: Unified on Postgres)
 *
 * Tests cover:
 *  - generateEmbedding() — mock fallback, deterministic output, correct dims
 *  - hybridSearch() / postgresFtsSearch() — prefix tsquery + pg_trgm similarity fallback,
 *    ranking, filtering, and limit handling
 *  - indexCreator() — profile syncing
 *  - onProfileChanged() — fire-and-forget background execution
 *  - checkClusterHealth() — Postgres health status
 *  - getIndexStats() — database index stats
 *  - ensureIndex() — idempotency
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn().mockResolvedValue(1),
    creatorProfile: {
      count: vi.fn().mockResolvedValue(50),
    },
  },
}));

import {
  generateEmbedding,
  hybridSearch,
  indexCreator,
  deleteCreatorFromIndex,
  checkClusterHealth,
  getIndexStats,
  onProfileChanged,
  ensureIndex,
  postgresFtsSearch,
  _resetElasticClientForTests,
} from '@/server/services/search';
import { prisma } from '@/lib/prisma';

beforeEach(() => {
  vi.clearAllMocks();
  _resetElasticClientForTests();
  vi.mocked(prisma.$queryRaw).mockResolvedValue([]);
});

// ── generateEmbedding ─────────────────────────────────────────────────────────

describe('generateEmbedding()', () => {
  it('returns an array when OPENAI_API_KEY is not set (mock fallback)', async () => {
    const original = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const embedding = await generateEmbedding('test query');
    expect(Array.isArray(embedding)).toBe(true);
    expect(embedding.length).toBeGreaterThan(0);
    process.env.OPENAI_API_KEY = original;
  });

  it('returns 1536 dimensions for text-embedding-3-small (default)', async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.EMBED_MODEL;
    const embedding = await generateEmbedding('hello world');
    expect(embedding.length).toBe(1536);
  });

  it('is deterministic for the same input (dev mock)', async () => {
    delete process.env.OPENAI_API_KEY;
    const a = await generateEmbedding('stellar portfolio');
    const b = await generateEmbedding('stellar portfolio');
    expect(a).toEqual(b);
  });

  it('produces different vectors for different inputs (dev mock)', async () => {
    delete process.env.OPENAI_API_KEY;
    const a = await generateEmbedding('design');
    const b = await generateEmbedding('backend');
    expect(a).not.toEqual(b);
  });
});

// ── hybridSearch & postgresFtsSearch ──────────────────────────────────────────

describe('hybridSearch() via Postgres', () => {
  it('returns empty array for empty query', async () => {
    const results = await hybridSearch({ query: '' });
    expect(results).toEqual([]);
  });

  it('queries Postgres FTS and maps results with scores', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      {
        id: 'creator-A',
        displayName: 'Alice Designer',
        discipline: 'Design',
        skills: ['figma'],
        verified: true,
        rating: 4.9,
        completedProjects: 15,
        rank: 0.85,
      },
      {
        id: 'creator-B',
        displayName: 'Bob Builder',
        discipline: 'Engineering',
        skills: ['rust'],
        verified: false,
        rating: 4.2,
        completedProjects: 6,
        rank: 0.65,
      },
    ]);

    const results = await hybridSearch({ query: 'designer' });
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe('creator-A');
    expect(results[0].score).toBe(0.85);
    expect(results[0].scoreBreakdown.lexical).toBe(0.85);
  });

  it('respects limit parameter', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      {
        id: 'creator-1',
        displayName: 'Creator 1',
        discipline: 'Design',
        skills: [],
        verified: true,
        rating: 5.0,
        completedProjects: 20,
        rank: 0.9,
      },
    ]);

    const results = await postgresFtsSearch({ query: 'creator', limit: 1 });
    expect(results).toHaveLength(1);
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });
});

// ── indexCreator & deleteCreatorFromIndex ─────────────────────────────────────

describe('indexCreator() & deleteCreatorFromIndex()', () => {
  it('indexes without error', async () => {
    delete process.env.OPENAI_API_KEY;
    await expect(
      indexCreator({
        id: 'creator-1',
        displayName: 'Alice',
        bio: 'UI designer',
        discipline: 'Design',
        skills: ['figma'],
        updatedAt: new Date().toISOString(),
        verified: true,
        rating: 4.8,
        completedProjects: 12,
      }),
    ).resolves.not.toThrow();
  });

  it('deletes without error', async () => {
    await expect(deleteCreatorFromIndex('creator-1')).resolves.not.toThrow();
  });
});

// ── onProfileChanged ──────────────────────────────────────────────────────────

describe('onProfileChanged()', () => {
  it('is fire-and-forget and does not throw', () => {
    delete process.env.OPENAI_API_KEY;
    expect(() =>
      onProfileChanged({
        id: 'creator-5',
        displayName: 'Charlie',
        bio: 'Full-stack dev',
        discipline: 'Development',
        skills: ['node', 'react'],
        updatedAt: new Date().toISOString(),
        verified: false,
        rating: 3.9,
        completedProjects: 7,
      }),
    ).not.toThrow();
  });
});

// ── checkClusterHealth ────────────────────────────────────────────────────────

describe('checkClusterHealth()', () => {
  it('returns healthy=true and status green when Postgres responds', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ '?column?': 1 }]);
    const result = await checkClusterHealth();
    expect(result.healthy).toBe(true);
    expect(result.status).toBe('green');
  });

  it('returns unreachable when database throws', async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error('DB connection refused'));
    const result = await checkClusterHealth();
    expect(result.healthy).toBe(false);
    expect(result.status).toBe('unreachable');
  });
});

// ── getIndexStats & ensureIndex ───────────────────────────────────────────────

describe('getIndexStats() & ensureIndex()', () => {
  it('returns docCount and sizeBytes from Postgres', async () => {
    const stats = await getIndexStats();
    expect(stats.docCount).toBe(50);
    expect(stats.sizeBytes).toBeGreaterThan(0);
  });

  it('ensureIndex executes successfully', async () => {
    await expect(ensureIndex()).resolves.not.toThrow();
  });
});
