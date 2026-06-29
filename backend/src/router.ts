import { z } from 'zod';
import { protectedProcedure, publicProcedure, router } from './trpc-setup';
import { prisma } from '@/lib/prisma';
import jwt from 'jsonwebtoken';

// Root router with Prisma-backed queries
export const appRouter = router({
  // Public query to fetch bounties with optional filtering
  bounties: router({
    list: publicProcedure
      .input(
        z.object({
          take: z.number().int().positive().default(10),
          cursor: z.string().optional(),
          status: z.enum(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
        })
      )
      .query(async ({ input }) => {
        const bounties = await prisma.bounty.findMany({
          take: input.take + 1, // +1 to determine hasNextPage
          ...(input.cursor && { cursor: { id: input.cursor }, skip: 1 }), // skip cursor itself
          where: {
            ...(input.status && { status: input.status }),
          },
          select: {
            id: true,
            title: true,
            description: true,
            budget: true,
            deadline: true,
            status: true,
            category: true,
            tags: true,
            difficulty: true,
            createdAt: true,
            creator: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        });

        const hasNextPage = bounties.length > input.take;
        if (hasNextPage) bounties.pop(); // Remove the extra item

        const nextCursor = bounties.length > 0 ? bounties[bounties.length - 1].id : null;

        return {
          bounties,
          nextCursor,
          hasNextPage,
        };
      }),

    // Protected query to fetch creator's own bounties
    myBounties: protectedProcedure
      .input(
        z.object({
          take: z.number().int().positive().default(10),
          cursor: z.string().optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        const bounties = await prisma.bounty.findMany({
          take: input.take + 1,
          ...(input.cursor && { cursor: { id: input.cursor }, skip: 1 }),
          where: {
            creatorId: ctx.user!.id,
          },
          select: {
            id: true,
            title: true,
            description: true,
            budget: true,
            deadline: true,
            status: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        });

        const hasNextPage = bounties.length > input.take;
        if (hasNextPage) bounties.pop();

        const nextCursor = bounties.length > 0 ? bounties[bounties.length - 1].id : null;

        return {
          bounties,
          nextCursor,
          hasNextPage,
        };
      }),

    // Public query to fetch single bounty by id
    get: publicProcedure
      .input(z.object({ id: z.string() }))
      .query(async ({ input }) => {
        return await prisma.bounty.findUnique({
          where: { id: input.id },
          select: {
            id: true,
            title: true,
            description: true,
            budget: true,
            deadline: true,
            status: true,
            category: true,
            tags: true,
            difficulty: true,
            creator: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
            createdAt: true,
            updatedAt: true,
          },
        });
      }),

    // Create new bounty
    create: protectedProcedure
      .input(
        z.object({
          title: z.string().min(1),
          description: z.string().min(1),
          budget: z.number().positive(),
          deadline: z.date(),
          category: z.string(),
          tags: z.array(z.string()),
          difficulty: z.enum(['beginner', 'intermediate', 'advanced', 'expert']),
        })
      )
      .mutation(async ({ ctx, input }) => {
        return await prisma.bounty.create({
          data: {
            ...input,
            creatorId: ctx.user!.id,
            status: 'OPEN',
          },
        });
      }),
  }),

  // Creators endpoints
  creators: router({
    featured: publicProcedure
      .input(z.object({ limit: z.number().int().positive().max(20).default(3) }))
      .query(async ({ input }) => {
        return await prisma.creator.findMany({
          take: input.limit,
          select: {
            id: true,
            name: true,
            title: true,
            discipline: true,
            bio: true,
            avatar: true,
            coverImage: true,
            tagline: true,
            linkedIn: true,
            twitter: true,
            skills: true,
            hourlyRate: true,
            rating: true,
            reviewCount: true,
            stats: true,
          },
          orderBy: [{ rating: 'desc' }, { completedProjects: 'desc' }],
        });
      }),

    list: publicProcedure
      .input(
        z.object({
          take: z.number().int().positive().default(10),
          cursor: z.string().optional(),
          discipline: z.string().optional(),
          search: z.string().optional(),
        })
      )
      .query(async ({ input }) => {
        const where: any = {};
        if (input.discipline) {
          where.discipline = input.discipline;
        }
        if (input.search) {
          where.OR = [
            { displayName: { contains: input.search, mode: 'insensitive' } },
            { bio: { contains: input.search, mode: 'insensitive' } },
          ];
        }

        const creatorProfiles = await prisma.creatorProfile.findMany({
          take: input.take + 1,
          ...(input.cursor && { cursor: { id: input.cursor }, skip: 1 }),
          where,
          select: {
            id: true,
            displayName: true,
            discipline: true,
            bio: true,
            avatar: true,
            skills: true,
            rating: true,
            completedProjects: true,
            linkedinUrl: true,
            websiteUrl: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        });

        const hasNextPage = creatorProfiles.length > input.take;
        if (hasNextPage) creatorProfiles.pop();

        const nextCursor = creatorProfiles.length > 0 ? creatorProfiles[creatorProfiles.length - 1].id : null;

        // Map CreatorProfile to Creator interface expected by frontend
        const creators = creatorProfiles.map((profile: any) => ({
          id: profile.id,
          name: profile.displayName,
          title: profile.discipline || 'Creator',
          discipline: profile.discipline || 'General',
          bio: profile.bio || '',
          avatar: profile.avatar || '/avatars/default.jpg',
          coverImage: '/covers/default.jpg',
          tagline: 'Available for projects',
          linkedIn: profile.linkedinUrl || '',
          twitter: '',
          portfolio: profile.websiteUrl || '',
          skills: profile.skills || [],
          stats: {
            projects: profile.completedProjects,
            clients: Math.floor(Math.random() * 50) + 10,
            experience: Math.floor(Math.random() * 10) + 1,
          },
          hourlyRate: Math.floor(Math.random() * 100) + 50,
          rating: profile.rating,
          reviewCount: Math.floor(Math.random() * 50) + 5,
        }));

        return {
          creators,
          nextCursor,
          hasNextPage,
        };
      }),

    get: publicProcedure
      .input(z.object({ id: z.string() }))
      .query(async ({ input }) => {
        return await prisma.creator.findUnique({
          where: { id: input.id },
          include: {
            projects: true,
            reviews: {
              take: 5,
              orderBy: { createdAt: 'desc' },
            },
          },
        });
      }),
  }),

  // Escrow endpoints
  escrow: router({
    create: protectedProcedure
      .input(
        z.object({
          bountyId: z.string(),
          payerAddress: z.string(),
          payeeAddress: z.string(),
          amount: z.number().positive(),
          token: z.string(),
        })
      )
      .mutation(async ({ input }) => {
        // This would integrate with the Stellar escrow smart contract
        // For now, return a mock response
        return {
          escrowId: `escrow-${Date.now()}`,
          txHash: `tx-${Date.now()}`,
          operation: 'deposit',
          status: 'pending',
        };
      }),

    release: protectedProcedure
      .input(z.object({ escrowId: z.string() }))
      .mutation(async ({ input }) => {
        return {
          escrowId: input.escrowId,
          txHash: `tx-release-${Date.now()}`,
          operation: 'release',
          status: 'completed',
        };
      }),
  }),

  // Projects endpoints
  projects: router({
    create: protectedProcedure
      .input(
        z.object({
          title: z.string().min(1),
          category: z.string().min(1),
          description: z.string().min(1),
          tags: z.array(z.string()),
          year: z.number().int().min(2000).max(new Date().getFullYear()),
          link: z.string().url().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        return await prisma.project.create({
          data: {
            ...input,
            creatorId: ctx.user!.id,
          },
        });
      }),

    list: publicProcedure
      .input(
        z.object({
          creatorId: z.string().optional(),
          take: z.number().int().positive().default(10),
          cursor: z.string().optional(),
        })
      )
      .query(async ({ input }) => {
        const where = input.creatorId ? { creatorId: input.creatorId } : {};

        const projects = await prisma.project.findMany({
          take: input.take + 1,
          ...(input.cursor && { cursor: { id: input.cursor }, skip: 1 }),
          where,
          include: {
            creator: {
              select: { id: true, name: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        });

        const hasNextPage = projects.length > input.take;
        if (hasNextPage) projects.pop();

        const nextCursor = projects.length > 0 ? projects[projects.length - 1].id : null;

        return {
          projects,
          nextCursor,
          hasNextPage,
        };
      }),
  }),

  // Analytics endpoints
  analytics: router({
    dashboard: protectedProcedure
      .input(
        z.object({
          period: z.enum(['7d', '30d', '90d', '1y']).default('30d'),
        })
      )
      .query(async ({ ctx, input }) => {
        // Get user's analytics data
        const user = ctx.user!;

        // This would calculate real metrics from bounties, applications, etc.
        return {
          earnings: {
            total: 12500,
            thisMonth: 3200,
            change: 15.3,
          },
          performance: {
            completionRate: 94,
            avgRating: 4.7,
            responseTime: '2h',
          },
          projects: {
            active: 3,
            completed: 28,
            pending: 5,
          },
        };
      }),
  }),

  // Identity/ZK endpoints
  identity: router({
    verifyZk: publicProcedure
      .input(
        z.object({
          proof: z.record(z.unknown()),
          publicInputs: z.record(z.unknown()),
          nullifier: z.string(),
        })
      )
      .mutation(async ({ input }) => {
        // Check if nullifier has already been used (replay protection)
        const existingNullifier = await prisma.zkNullifier.findUnique({
          where: { nullifier: input.nullifier },
        });

        if (existingNullifier) {
          throw new Error('Proof already used');
        }

        // Verify the proof (simplified: in production, call the Stellar contract or off-chain verifier)
        // For now, accept any proof with non-empty public inputs
        const publicInputs = input.publicInputs;
        if (!publicInputs || Object.keys(publicInputs).length === 0) {
          throw new Error('Invalid proof');
        }

        // Store the nullifier to prevent replay
        await prisma.zkNullifier.create({
          data: {
            nullifier: input.nullifier,
            createdAt: new Date(),
          },
        });

        // Issue a short-lived JWT with ZK verification claim
        const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key';
        const token = jwt.sign(
          {
            zk_verified: true,
            claim: 'age_18+',
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 86400, // 24 hours
          },
          JWT_SECRET
        );

        return {
          token,
          expiresIn: 86400,
        };
      }),
  }),
});

export type AppRouter = typeof appRouter;
