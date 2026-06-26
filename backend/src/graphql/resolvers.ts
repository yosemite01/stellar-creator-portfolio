import { prisma } from '@/lib/prisma';
import { GraphQLContext } from './context';

export const resolvers = {
  Query: {
    async bounties(_: any, args: any, ctx: GraphQLContext) {
      if (!ctx.isAuthenticated && args.take > 50) {
        throw new Error('Unauthenticated requests limited to 50 results');
      }

      const bounties = await prisma.bounty.findMany({
        take: (args.take || 10) + 1,
        ...(args.cursor && { cursor: { id: args.cursor }, skip: 1 }),
        where: {
          ...(args.status && { status: args.status }),
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

      const hasNextPage = bounties.length > (args.take || 10);
      if (hasNextPage) bounties.pop();

      const nextCursor = bounties.length > 0 ? bounties[bounties.length - 1].id : null;

      return {
        bounties,
        nextCursor,
        hasNextPage,
      };
    },

    async bounty(_: any, args: any) {
      return await prisma.bounty.findUnique({
        where: { id: args.id },
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
    },

    async creators(_: any, args: any) {
      const where: any = {};
      if (args.discipline) {
        where.discipline = args.discipline;
      }
      if (args.search) {
        where.OR = [
          { displayName: { contains: args.search, mode: 'insensitive' } },
          { bio: { contains: args.search, mode: 'insensitive' } },
        ];
      }

      const creators = await prisma.creatorProfile.findMany({
        take: (args.take || 10) + 1,
        ...(args.cursor && { cursor: { id: args.cursor }, skip: 1 }),
        where,
        select: {
          id: true,
          displayName: true,
          discipline: true,
          bio: true,
          avatar: true,
          rating: true,
          verified: true,
          verificationTier: true,
          skills: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      const hasNextPage = creators.length > (args.take || 10);
      if (hasNextPage) creators.pop();

      const nextCursor = creators.length > 0 ? creators[creators.length - 1].id : null;

      return {
        creators: creators.map(c => ({
          ...c,
          name: c.displayName,
        })),
        nextCursor,
        hasNextPage,
      };
    },

    async creator(_: any, args: any) {
      return await prisma.creatorProfile.findUnique({
        where: { id: args.id },
        select: {
          id: true,
          displayName: true,
          discipline: true,
          bio: true,
          avatar: true,
          rating: true,
          verified: true,
          verificationTier: true,
          skills: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });
    },

    async projects(_: any, args: any) {
      const projects = await prisma.bounty.findMany({
        take: (args.take || 10) + 1,
        ...(args.cursor && { cursor: { id: args.cursor }, skip: 1 }),
        orderBy: { createdAt: 'desc' },
      });

      const hasNextPage = projects.length > (args.take || 10);
      if (hasNextPage) projects.pop();

      const nextCursor = projects.length > 0 ? projects[projects.length - 1].id : null;

      return {
        projects: projects.map(p => ({
          id: p.id,
          title: p.title,
          category: p.category,
          description: p.description,
          tags: p.tags,
          year: new Date(p.createdAt).getFullYear(),
          link: null,
        })),
        nextCursor,
        hasNextPage,
      };
    },

    async myBounties(_: any, args: any, ctx: GraphQLContext) {
      if (!ctx.userId) {
        throw new Error('Authentication required');
      }

      const bounties = await prisma.bounty.findMany({
        take: (args.take || 10) + 1,
        ...(args.cursor && { cursor: { id: args.cursor }, skip: 1 }),
        where: { creatorId: ctx.userId },
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

      const hasNextPage = bounties.length > (args.take || 10);
      if (hasNextPage) bounties.pop();

      const nextCursor = bounties.length > 0 ? bounties[bounties.length - 1].id : null;

      return {
        bounties,
        nextCursor,
        hasNextPage,
      };
    },

    async analytics(_: any, args: any, ctx: GraphQLContext) {
      if (!ctx.userId) {
        throw new Error('Authentication required');
      }

      const [totalBounties, totalCreators, totalProjects] = await Promise.all([
        prisma.bounty.count(),
        prisma.creatorProfile.count(),
        prisma.bounty.count(), // Using bounties as projects proxy for now
      ]);

      const reviews = await prisma.review.findMany({
        select: { rating: true },
      });

      const averageRating = reviews.length > 0
        ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
        : 0;

      return {
        totalBounties,
        totalCreators,
        totalProjects,
        averageRating,
      };
    },
  },

  Mutation: {
    async createBounty(_: any, args: any, ctx: GraphQLContext) {
      if (!ctx.userId) {
        throw new Error('Authentication required');
      }

      return await prisma.bounty.create({
        data: {
          title: args.title,
          description: args.description,
          budget: args.budget,
          deadline: new Date(args.deadline),
          category: args.category,
          tags: args.tags,
          difficulty: args.difficulty,
          creatorId: ctx.userId,
          status: 'OPEN',
        },
      });
    },

    async createProject(_: any, args: any, ctx: GraphQLContext) {
      if (!ctx.userId) {
        throw new Error('Authentication required');
      }

      // Projects are stored as bounties in this schema for now
      return {
        id: `proj-${Date.now()}`,
        title: args.title,
        category: args.category,
        description: args.description,
        tags: args.tags,
        year: args.year,
        link: args.link,
        creator: { id: ctx.userId, name: '', email: '' },
        createdAt: new Date().toISOString(),
      };
    },
  },
};
