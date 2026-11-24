import { describe, it, expect, vi } from 'vitest';
import { searchCreators, searchBounties, getCreatorSearchSuggestions } from '@/lib/search-utils';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    creatorProfile: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'creator-1',
          displayName: 'Alice Designer',
          bio: 'UI/UX specialist',
          discipline: 'Design',
          skills: ['figma', 'ui'],
          rating: 4.9,
          completedProjects: 12,
          user: { id: 'u1', email: 'alice@example.com', name: 'Alice', image: null },
        },
      ]),
      count: vi.fn().mockResolvedValue(1),
    },
    bounty: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'bounty-1',
          title: 'Design landing page',
          description: 'Need modern figma designs',
          budget: 500,
          difficulty: 'intermediate',
          category: 'design',
          status: 'OPEN',
          tags: ['figma', 'landing'],
          createdAt: new Date(),
        },
      ]),
      count: vi.fn().mockResolvedValue(1),
    },
  },
}));

describe('Issue #1760: Single data access path via Prisma', () => {
  it('queries creators through Prisma creatorProfile instead of Supabase client', async () => {
    const result = await searchCreators({ query: 'Alice', discipline: 'Design' });
    expect(prisma.creatorProfile.findMany).toHaveBeenCalled();
    expect(result.data).toHaveLength(1);
    expect(result.data[0].displayName).toBe('Alice Designer');
    expect(result.count).toBe(1);
  });

  it('queries bounties through Prisma bounty model', async () => {
    const result = await searchBounties({ query: 'landing', category: 'design' });
    expect(prisma.bounty.findMany).toHaveBeenCalled();
    expect(result.data).toHaveLength(1);
    expect(result.data[0].title).toBe('Design landing page');
    expect(result.count).toBe(1);
  });

  it('retrieves creator suggestions using Prisma', async () => {
    const suggestions = await getCreatorSearchSuggestions('Ali');
    expect(prisma.creatorProfile.findMany).toHaveBeenCalled();
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].title).toBe('Alice Designer');
  });
});
