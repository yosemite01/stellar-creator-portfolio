import { execSync } from 'child_process';
import { Client } from 'pg';

export default async function setup() {
  const databaseUrl =
    process.env.TEST_DATABASE_URL ||
    'postgresql://postgres:postgres@localhost:5433/test_db';

  console.log(`[Integration Test Setup] Verifying PostgreSQL connection at ${databaseUrl}...`);

  const client = new Client({ connectionString: databaseUrl });
  let isConnected = false;

  try {
    await client.connect();
    isConnected = true;
    console.log('[Integration Test Setup] PostgreSQL test instance reached.');
  } catch (err: any) {
    console.warn(
      `[Integration Test Setup] Could not connect to test PostgreSQL instance: ${err.message}. ` +
      `Start it with: "pnpm run db:test:up"`
    );
  } finally {
    if (isConnected) {
      await client.end();
    }
  }

  if (isConnected) {
    try {
      console.log('[Integration Test Setup] Running prisma migrate deploy on test database...');
      execSync('pnpm exec prisma migrate deploy', {
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
        },
        stdio: 'inherit',
      });
      console.log('[Integration Test Setup] Migrations deployed successfully.');
    } catch (err: any) {
      console.error('[Integration Test Setup] Migration failed:', err.message);
      throw err;
    }
  }
}

export async function teardown() {
  console.log('[Integration Test Setup] Integration test run finished.');
}
