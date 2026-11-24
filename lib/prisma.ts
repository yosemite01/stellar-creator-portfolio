import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/lib/generated/prisma/client';
import { prismaTracingExtension } from '@/server/services/tracing';

/**
 * Build a PrismaClient connected through the pg driver adapter (Prisma 7
 * requires a driver adapter; the schema no longer carries a URL).
 *
 * When PgBouncer is in use, DATABASE_URL points to the pooler (port 6432).
 * DIRECT_DATABASE_URL is only used by Prisma Migrate (see prisma.config.ts).
 *
 * The adapter connects lazily, so a missing DATABASE_URL does not throw at
 * import time (which would break `next build` and any test that merely
 * imports a route module); it surfaces on the first query instead.
 */
export function createPrismaClient(
  connectionString: string | undefined = process.env.DATABASE_URL,
): PrismaClient {
  const adapter = new PrismaPg({ connectionString });
  const client = new PrismaClient({ adapter });
  // Attach OpenTelemetry tracing — creates a child span per DB query.
  // A query-only extension does not change the client's type surface, so
  // the extended client is still exposed as PrismaClient.
  return client.$extends(prismaTracingExtension) as unknown as PrismaClient;
}

let prisma: PrismaClient;

if (process.env.NODE_ENV === 'production') {
  prisma = createPrismaClient();
} else {
  const globalWithPrisma = global as typeof global & {
    prisma: PrismaClient;
  };
  if (!globalWithPrisma.prisma) {
    globalWithPrisma.prisma = createPrismaClient();
  }
  prisma = globalWithPrisma.prisma;
}

export { prisma };
