import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCreatorProfile, mockProject } = vi.hoisted(() => ({
  mockCreatorProfile: {
    count: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
  },
  mockProject: {
    findMany: vi.fn(),
  },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    creatorProfile: mockCreatorProfile,
    project: mockProject,
  },
}));

import {
  listCreatorsFromDB,
  getCreatorByIdFromDB,
  encodeCursor,
  decodeCursor,
  invalidateCreatorsCache,
} from '@/server/services/creators-directory';
import { GET as getCreatorsRoute } from '@/app/api/creators/route';
import { GET as getCreatorByIdRoute } from '@/app/api/creators/[id]/route';
import { NextRequest } from 'next/server';

describe('Creators Directory DB Listing & Pagination (Issue #1824)', () => {
  beforeEach(() => {
    invalidateCreatorsCache();
    vi.restoreAllMocks();
    mockCreatorProfile.count.mockResolvedValue(0);
    mockCreatorProfile.findMany.mockResolvedValue([]);
    mockCreatorProfile.findFirst.mockResolvedValue(null);
    mockProject.findMany.mockResolvedValue([]);
  });

  describe('encodeCursor & decodeCursor', () => {
    it('round-trips id and createdAt correctly', () => {
      const id = 'c-123';
      const date = new Date('2026-11-16T12:00:00.000Z');
      const cursor = encodeCursor(id, date);
      expect(typeof cursor).toBe('string');

      const decoded = decodeCursor(cursor);
      expect(decoded).not.toBeNull();
      expect(decoded?.id).toBe(id);
      expect(decoded?.createdAt.toISOString()).toBe(date.toISOString());
    });

    it('returns null for malformed cursor strings', () => {
      expect(decodeCursor('invalid-base64-not-json')).toBeNull();
      expect(decodeCursor('')).toBeNull();
    });
  });

  describe('listCreatorsFromDB', () => {
    const mockProfiles = [
      {
        id: 'p5',
        displayName: 'Creator Five',
        discipline: 'Design',
        bio: 'Product Designer',
        avatar: '/avatars/5.jpg',
        skills: ['Figma', 'UI'],
        rating: 4.9,
        completedProjects: 20,
        linkedinUrl: 'https://linkedin.com/5',
        websiteUrl: 'https://5.design',
        verified: true,
        createdAt: new Date('2026-11-16T15:00:00Z'),
      },
      {
        id: 'p4',
        displayName: 'Creator Four',
        discipline: 'Development',
        bio: 'Rust and TypeScript Developer',
        avatar: '/avatars/4.jpg',
        skills: ['Rust', 'TypeScript'],
        rating: 4.8,
        completedProjects: 15,
        linkedinUrl: null,
        websiteUrl: null,
        verified: true,
        createdAt: new Date('2026-11-16T14:00:00Z'),
      },
      {
        id: 'p3',
        displayName: 'Creator Three',
        discipline: 'Design',
        bio: 'Graphic & Brand Designer',
        avatar: '/avatars/3.jpg',
        skills: ['Photoshop', 'Illustrator'],
        rating: 4.5,
        completedProjects: 8,
        linkedinUrl: null,
        websiteUrl: null,
        verified: false,
        createdAt: new Date('2026-11-16T13:00:00Z'),
      },
      {
        id: 'p2',
        displayName: 'Creator Two',
        discipline: 'Writing',
        bio: 'Technical Copywriter',
        avatar: '/avatars/2.jpg',
        skills: ['Writing', 'Docs'],
        rating: 4.2,
        completedProjects: 5,
        linkedinUrl: null,
        websiteUrl: null,
        verified: false,
        createdAt: new Date('2026-11-16T12:00:00Z'),
      },
      {
        id: 'p1',
        displayName: 'Creator One',
        discipline: 'Development',
        bio: 'Junior Frontend Developer',
        avatar: '/avatars/1.jpg',
        skills: ['React', 'CSS'],
        rating: 3.9,
        completedProjects: 2,
        linkedinUrl: null,
        websiteUrl: null,
        verified: false,
        createdAt: new Date('2026-11-16T11:00:00Z'),
      },
    ];

    it('returns first page up to take with hasNextPage=true and valid nextCursor', async () => {
      const mockPrisma = {
        creatorProfile: {
          count: vi.fn().mockResolvedValue(5),
          findMany: vi.fn().mockResolvedValue([mockProfiles[0], mockProfiles[1], mockProfiles[2]]), // take=2 + 1
        },
      };

      const res = await listCreatorsFromDB({ take: 2 }, mockPrisma);

      expect(res.creators).toHaveLength(2);
      expect(res.creators[0].id).toBe('p5');
      expect(res.creators[1].id).toBe('p4');
      expect(res.hasNextPage).toBe(true);
      expect(res.total).toBe(5);
      expect(res.nextCursor).not.toBeNull();

      const decoded = decodeCursor(res.nextCursor!);
      expect(decoded?.id).toBe('p4');
      expect(decoded?.createdAt.toISOString()).toBe(mockProfiles[1].createdAt.toISOString());
    });

    it('handles last page with hasNextPage=false and nextCursor=null', async () => {
      const mockPrisma = {
        creatorProfile: {
          count: vi.fn().mockResolvedValue(2),
          findMany: vi.fn().mockResolvedValue([mockProfiles[3], mockProfiles[4]]), // exactly take=2, no extra
        },
      };

      const res = await listCreatorsFromDB({ take: 2, cursor: 'any-cursor' }, mockPrisma);

      expect(res.creators).toHaveLength(2);
      expect(res.hasNextPage).toBe(false);
      expect(res.nextCursor).toBeNull();
    });

    it('guarantees pagination stability under concurrent inserts (test plan requirement)', async () => {
      // Step 1: User requests page 1 (take: 2) -> gets p5 and p4
      let capturedWherePage2: any = null;

      const mockPrisma = {
        creatorProfile: {
          count: vi.fn().mockResolvedValue(5),
          findMany: vi.fn().mockImplementation((args: any) => {
            if (args.where?.AND) {
              capturedWherePage2 = args.where;
              // Page 2 request with cursor pointing to p4
              return Promise.resolve([mockProfiles[2], mockProfiles[3], mockProfiles[4]]);
            }
            // Page 1
            return Promise.resolve([mockProfiles[0], mockProfiles[1], mockProfiles[2]]);
          }),
        },
      };

      const page1 = await listCreatorsFromDB({ take: 2 }, mockPrisma);
      expect(page1.creators.map((c) => c.id)).toEqual(['p5', 'p4']);
      expect(page1.nextCursor).not.toBeNull();

      // Step 2: In the background, new records with timestamp > p5 are inserted
      // When page 2 is fetched using page1.nextCursor:
      invalidateCreatorsCache(); // Clear cache to simulate independent request
      const page2 = await listCreatorsFromDB({ take: 2, cursor: page1.nextCursor! }, mockPrisma);

      // Verify that page 2 does not duplicate p5 or p4, and returns p3 and p2
      expect(page2.creators.map((c) => c.id)).toEqual(['p3', 'p2']);

      // Verify the composite WHERE clause strictly filters out anything >= p4's timestamp
      expect(capturedWherePage2).toBeDefined();
      expect(capturedWherePage2.AND[0].OR).toEqual([
        { createdAt: { lt: mockProfiles[1].createdAt } },
        {
          AND: [
            { createdAt: { equals: mockProfiles[1].createdAt } },
            { id: { lt: 'p4' } },
          ],
        },
      ]);
    });

    it('filters by discipline and search query', async () => {
      let passedWhere: any = null;
      const mockPrisma = {
        creatorProfile: {
          count: vi.fn().mockResolvedValue(1),
          findMany: vi.fn().mockImplementation((args: any) => {
            passedWhere = args.where;
            return Promise.resolve([mockProfiles[0]]);
          }),
        },
      };

      const res = await listCreatorsFromDB(
        { discipline: 'Design', search: 'Product' },
        mockPrisma,
      );

      expect(res.creators).toHaveLength(1);
      expect(passedWhere.discipline).toEqual({ equals: 'Design', mode: 'insensitive' });
      expect(passedWhere.OR).toEqual([
        { displayName: { contains: 'Product', mode: 'insensitive' } },
        { bio: { contains: 'Product', mode: 'insensitive' } },
      ]);
    });

    it('caches query results and avoids redundant DB queries', async () => {
      const mockPrisma = {
        creatorProfile: {
          count: vi.fn().mockResolvedValue(5),
          findMany: vi.fn().mockResolvedValue([mockProfiles[0], mockProfiles[1]]),
        },
      };

      // Call 1
      const res1 = await listCreatorsFromDB({ take: 2, discipline: 'Development' }, mockPrisma);
      // Call 2 (identical)
      const res2 = await listCreatorsFromDB({ take: 2, discipline: 'Development' }, mockPrisma);

      expect(res1).toEqual(res2);
      expect(mockPrisma.creatorProfile.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.creatorProfile.count).toHaveBeenCalledTimes(1);
    });
  });

  describe('getCreatorByIdFromDB', () => {
    it('returns creator with projects from DB when found', async () => {
      const mockProfile = {
        id: 'c-db-1',
        displayName: 'DB Creator',
        discipline: 'Development',
        bio: 'Fullstack Dev',
        avatar: '/avatars/db.jpg',
        skills: ['Solidity', 'Rust'],
        rating: 5.0,
        completedProjects: 10,
        linkedinUrl: null,
        websiteUrl: null,
        verified: true,
        createdAt: new Date(),
        userId: 'u-100',
      };

      const mockProjects = [
        {
          id: 'proj-1',
          title: 'DeFi Protocol',
          description: 'AMM with constant product pool',
          category: 'Development',
          tags: ['DeFi', 'Rust'],
          year: 2026,
          link: 'https://defi.org',
          createdAt: new Date(),
        },
      ];

      const mockPrisma = {
        creatorProfile: {
          findFirst: vi.fn().mockResolvedValue(mockProfile),
        },
        project: {
          findMany: vi.fn().mockResolvedValue(mockProjects),
        },
      };

      const creator = await getCreatorByIdFromDB('c-db-1', mockPrisma);
      expect(creator).not.toBeNull();
      expect(creator?.name).toBe('DB Creator');
      expect(creator?.projects).toHaveLength(1);
      expect(creator?.projects[0].title).toBe('DeFi Protocol');
    });

    it('falls back to legacy static creator when not in DB', async () => {
      const mockPrisma = {
        creatorProfile: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      };

      const creator = await getCreatorByIdFromDB('alex-studio', mockPrisma);
      expect(creator).not.toBeNull();
      expect(creator?.name).toBe('Alex Chen');
    });

    it('returns null if neither DB nor static data contains creator', async () => {
      const mockPrisma = {
        creatorProfile: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      };

      const creator = await getCreatorByIdFromDB('unknown-creator-id-xyz', mockPrisma);
      expect(creator).toBeNull();
    });
  });

  describe('REST Endpoints Integration', () => {
    it('GET /api/creators returns 200 with cache headers and creator list', async () => {
      const req = new NextRequest('http://localhost:3000/api/creators?take=5&discipline=Design');
      const response = await getCreatorsRoute(req);

      expect(response.status).toBe(200);
      expect(response.headers.get('Cache-Control')).toContain('s-maxage=60');

      const json = await response.json();
      expect(json).toHaveProperty('creators');
      expect(json).toHaveProperty('nextCursor');
      expect(json).toHaveProperty('hasNextPage');
    });

    it('GET /api/creators returns 400 for invalid query parameters', async () => {
      const req = new NextRequest('http://localhost:3000/api/creators?take=-1');
      const response = await getCreatorsRoute(req);
      expect(response.status).toBe(400);
    });

    it('GET /api/creators/[id] returns 404 for unknown creator', async () => {
      const req = new NextRequest('http://localhost:3000/api/creators/non-existent-user-id');
      const response = await getCreatorByIdRoute(req, {
        params: Promise.resolve({ id: 'non-existent-user-id' }),
      });
      expect(response.status).toBe(404);
    });
  });
});
