import { z } from 'zod';
import { protectedProcedure, publicProcedure, rateLimit, router } from './trpc';
import { emitEvent } from '@/server/services/events';
import { writeAuditLog } from '@/server/services/audit';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { creatorCardSelect, toCreator } from './creator-mapper';
import { getJwtSecret } from './jwt-secret';
import jwt from 'jsonwebtoken';
import { TRPCError } from '@trpc/server';
import { sanitizeRichText, hasRichTextContent } from '@/lib/rich-text/sanitize';

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
          /** Minimum budget filter (inclusive, in USD cents or base unit). */
          budget_min: z.number().int().nonnegative().optional(),
          /** Maximum budget filter (inclusive). */
          budget_max: z.number().int().positive().optional(),
        })
      )
      .use(rateLimit({ windowMs: 60_000, max: 60 }))
      .query(async ({ input }) => {
        const budgetFilter: Record<string, number> = {};
        if (input.budget_min !== undefined) budgetFilter.gte = input.budget_min;
        if (input.budget_max !== undefined) budgetFilter.lte = input.budget_max;

        const bounties = await prisma.bounty.findMany({
          take: input.take + 1, // +1 to determine hasNextPage
          ...(input.cursor && { cursor: { id: input.cursor }, skip: 1 }), // skip cursor itself
          where: {
            ...(input.status && { status: input.status }),
            ...(Object.keys(budgetFilter).length > 0 && { budget: budgetFilter }),
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
      .use(rateLimit({ windowMs: 60_000, max: 300 }))
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
      .use(rateLimit({ windowMs: 60_000, max: 60 }))
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

    // Create new bounty — emits BountyCreated event and writes audit log
    create: protectedProcedure
      .input(
        z.object({
          title: z.string().min(1),
          description: z.string().min(1),
          budget: z.number().positive(),
          // Coerce: without a tRPC data transformer the deadline arrives as an ISO string.
          deadline: z.coerce.date(),
          category: z.string(),
          tags: z.array(z.string()),
          difficulty: z.enum(['beginner', 'intermediate', 'advanced', 'expert']),
        })
      )
      .use(rateLimit({ windowMs: 60_000, max: 300 }))
      .mutation(async ({ ctx, input }) => {
        const bounty = await prisma.bounty.create({
          data: {
            ...input,
            creatorId: ctx.user!.id,
            status: 'OPEN',
          },
        });

        // Emit domain event (non-blocking — listeners handle email/notifications)
        emitEvent('BountyCreated', {
          bountyId: bounty.id,
          creatorId: ctx.user!.id,
          title: bounty.title,
          budget: bounty.budget,
          category: bounty.category,
        });

        // Fire-and-forget audit log
        void writeAuditLog({
          userId: ctx.user!.id,
          resource: 'bounty',
          action: 'create',
          resourceId: bounty.id,
          payload: { title: bounty.title, budget: bounty.budget, status: 'OPEN' },
          status: 'SUCCESS',
          meta: {
            traceId: (ctx.req?.headers?.get?.('traceparent') ?? undefined) as string | undefined,
            httpMethod: 'POST',
            requestPath: '/api/trpc/bounties.create',
          },
        });

        return bounty;
      }),
  }),

  // Creators endpoints
  creators: router({
    featured: publicProcedure
      .input(z.object({ limit: z.number().int().positive().max(20).default(3) }))
      .use(rateLimit({ windowMs: 60_000, max: 60 }))
      .query(async ({ input }) => {
        const profiles = await prisma.creatorProfile.findMany({
          take: input.limit,
          select: creatorCardSelect,
          orderBy: [{ rating: 'desc' }, { completedProjects: 'desc' }],
        });
        return profiles.map(toCreator);
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
      .use(rateLimit({ windowMs: 60_000, max: 60 }))
      .query(async ({ input }) => {
        const where: Prisma.CreatorProfileWhereInput = {};
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
          select: creatorCardSelect,
          orderBy: { createdAt: 'desc' },
        });

        const hasNextPage = creatorProfiles.length > input.take;
        if (hasNextPage) creatorProfiles.pop();

        const nextCursor = creatorProfiles.length > 0 ? creatorProfiles[creatorProfiles.length - 1].id : null;

        const creators = creatorProfiles.map(toCreator);

        return {
          creators,
          nextCursor,
          hasNextPage,
        };
      }),

    get: publicProcedure
      .input(z.object({ id: z.string() }))
      .use(rateLimit({ windowMs: 60_000, max: 60 }))
      .query(async ({ input }) => {
        const profile = await prisma.creatorProfile.findUnique({
          where: { id: input.id },
          select: { ...creatorCardSelect, userId: true },
        });
        if (!profile) return null;

        const [projects, reviews] = await Promise.all([
          prisma.project.findMany({
            where: { creatorId: profile.userId },
            orderBy: { createdAt: 'desc' },
          }),
          prisma.review.findMany({
            where: { creatorId: profile.id, status: 'APPROVED' },
            take: 5,
            orderBy: { createdAt: 'desc' },
          }),
        ]);

        return { ...toCreator(profile), projects, reviews };
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
      .use(rateLimit({ windowMs: 60_000, max: 300 }))
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
      .use(rateLimit({ windowMs: 60_000, max: 300 }))
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
      .use(rateLimit({ windowMs: 60_000, max: 300 }))
      .mutation(async ({ ctx, input }) => {
        // Never trust client-sanitized HTML: sanitize again before persisting.
        const description = sanitizeRichText(input.description);
        if (!hasRichTextContent(description)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Project details cannot be empty.' });
        }

        return await prisma.project.create({
          data: {
            ...input,
            description,
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
      .use(rateLimit({ windowMs: 60_000, max: 60 }))
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
      .use(rateLimit({ windowMs: 60_000, max: 300 }))
      .query(async ({ ctx, input }) => {
        const userId = ctx.user!.id;

        const periodDays = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 }[input.period];
        const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);
        const prevSince = new Date(since.getTime() - periodDays * 24 * 60 * 60 * 1000);

        // Earnings from Transaction table grouped into current vs previous period
        const [txCurrent, txPrev] = await Promise.all([
          prisma.transaction.aggregate({
            where: { userId, type: 'payment', createdAt: { gte: since } },
            _sum: { amount: true },
          }),
          prisma.transaction.aggregate({
            where: { userId, type: 'payment', createdAt: { gte: prevSince, lt: since } },
            _sum: { amount: true },
          }),
        ]);

        const totalEarnings = txCurrent._sum.amount ?? 0;
        const prevEarnings = txPrev._sum.amount ?? 0;
        const earningsChange =
          prevEarnings > 0
            ? Math.round(((totalEarnings - prevEarnings) / prevEarnings) * 1000) / 10
            : 0;

        // Monthly earnings for this calendar month
        const monthStart = new Date();
        monthStart.setDate(1);
        monthStart.setHours(0, 0, 0, 0);
        const txMonth = await prisma.transaction.aggregate({
          where: { userId, type: 'payment', createdAt: { gte: monthStart } },
          _sum: { amount: true },
        });

        // Earnings time series — one point per period bucket
        const earningsTimeSeries = await prisma.$queryRaw<
          { bucket: Date; total: number }[]
        >`
          SELECT
            date_trunc(${periodDays <= 30 ? 'day' : 'week'}, "createdAt") AS bucket,
            SUM(amount)::integer                                           AS total
          FROM "Transaction"
          WHERE "userId" = ${userId}
            AND "type"   = 'payment'
            AND "createdAt" >= ${since}
          GROUP BY bucket
          ORDER BY bucket ASC
        `;

        // Bounty performance — creator's own bounties
        const [totalBounties, completedBounties, activeBounties, pendingBounties] =
          await Promise.all([
            prisma.bounty.count({ where: { creatorId: userId } }),
            prisma.bounty.count({ where: { creatorId: userId, status: 'COMPLETED' } }),
            prisma.bounty.count({ where: { creatorId: userId, status: 'IN_PROGRESS' } }),
            prisma.bounty.count({ where: { creatorId: userId, status: 'OPEN' } }),
          ]);

        const completionRate =
          totalBounties > 0 ? Math.round((completedBounties / totalBounties) * 100) : 0;

        // Average rating from Review table where the reviewer reviewed this creator
        const ratingAgg = await prisma.review.aggregate({
          where: { creatorId: userId, status: 'APPROVED' },
          _avg: { rating: true },
          _count: { id: true },
        });
        const avgRating = ratingAgg._avg.rating
          ? Math.round(ratingAgg._avg.rating * 10) / 10
          : 0;

        // Top skills by demand — tags on bounties where this creator applied
        const appliedBountyIds = (
          await prisma.bountyApplication.findMany({
            where: { applicantId: userId },
            select: { bountyId: true },
          })
        ).map((a) => a.bountyId);

        const tagRows = await prisma.bounty.findMany({
          where: { id: { in: appliedBountyIds } },
          select: { tags: true },
        });
        const tagFreq: Record<string, number> = {};
        for (const row of tagRows) {
          for (const tag of row.tags) {
            tagFreq[tag] = (tagFreq[tag] ?? 0) + 1;
          }
        }
        const topSkills = Object.entries(tagFreq)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([tag, count]) => ({ tag, count }));

        return {
          earnings: {
            total: totalEarnings,
            thisMonth: txMonth._sum.amount ?? 0,
            change: earningsChange,
            timeSeries: earningsTimeSeries.map((r) => ({
              date: r.bucket.toISOString().slice(0, 10),
              value: Number(r.total),
            })),
          },
          performance: {
            completionRate,
            avgRating,
            responseTime: '< 2h',
            totalReviews: ratingAgg._count.id,
          },
          projects: {
            active: activeBounties,
            completed: completedBounties,
            pending: pendingBounties,
            total: totalBounties,
          },
          topSkills,
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
      .use(rateLimit({ windowMs: 60_000, max: 10 }))
      .mutation(async ({ input }) => {
        // Check if nullifier has already been used (replay protection)
        const existingNullifier = await prisma.zKNullifier.findUnique({
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
        await prisma.zKNullifier.create({
          data: {
            nullifier: input.nullifier,
          },
        });

        // Issue a short-lived JWT with ZK verification claim
        const token = jwt.sign(
          {
            zk_verified: true,
            claim: 'age_18+',
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 86400, // 24 hours
          },
          getJwtSecret()
        );

        return {
          token,
          expiresIn: 86400,
        };
      }),
  }),
});

export type AppRouter = typeof appRouter;
