import { PrismaClient } from '@prisma/client';
import { createPrismaTracingMiddleware } from '@/backend/services/tracing';

function buildPrismaClient(): PrismaClient {
  // When PgBouncer is in use, DATABASE_URL points to the pooler (port 6432).
  // We pass it explicitly so Prisma uses the pooler URL at runtime.
  // DIRECT_DATABASE_URL is used by Prisma Migrate (set in schema.prisma directUrl).
  const client = new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
  });
  // Attach OpenTelemetry tracing middleware — creates a child span per DB query
  client.$use(createPrismaTracingMiddleware());
  return client;
}

let prisma: PrismaClient;

if (process.env.NODE_ENV === 'production') {
  prisma = buildPrismaClient();
} else {
  let globalWithPrisma = global as typeof global & {
    prisma: PrismaClient;
  };
  if (!globalWithPrisma.prisma) {
    globalWithPrisma.prisma = buildPrismaClient();
  }
  prisma = globalWithPrisma.prisma;
}

export { prisma };
