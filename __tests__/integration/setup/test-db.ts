import { PrismaClient } from '@prisma/client';
import { Client } from 'pg';

const baseDatabaseUrl =
  process.env.TEST_DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5433/test_db';

const workerId = process.env.VITEST_POOL_ID || '1';
const schemaName = `worker_${workerId}`;

let testPrisma: PrismaClient | null = null;

export async function initTestSchema(): Promise<string> {
  const client = new Client({ connectionString: baseDatabaseUrl });
  try {
    await client.connect();
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
    return schemaName;
  } catch (err: any) {
    console.warn(`[test-db] Schema creation skipped (${err.message})`);
    return 'public';
  } finally {
    try {
      await client.end();
    } catch {
      // ignore
    }
  }
}

export function getTestPrismaClient(): PrismaClient {
  if (!testPrisma) {
    const url = new URL(baseDatabaseUrl);
    url.searchParams.set('schema', schemaName);

    testPrisma = new PrismaClient({
      datasources: {
        db: {
          url: url.toString(),
        },
      },
    });
  }
  return testPrisma;
}

export async function truncateAllTables(prisma: PrismaClient) {
  try {
    const tablenames = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = ${schemaName} OR schemaname = 'public';
    `;

    const tables = tablenames
      .map(({ tablename }) => tablename)
      .filter((name) => name !== '_prisma_migrations');

    for (const table of tables) {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`);
    }
  } catch (err: any) {
    // If running in environment without live db, warn gently
    console.warn(`[test-db] Truncate skipped: ${err.message}`);
  }
}

export async function disconnectTestDatabase() {
  if (testPrisma) {
    await testPrisma.$disconnect();
    testPrisma = null;
  }
}
