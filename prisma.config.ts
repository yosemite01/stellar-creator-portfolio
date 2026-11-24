import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Prisma 7 no longer reads connection URLs from schema.prisma.
//
// The CLI (migrate deploy/dev/diff, db seed, studio) uses `datasource.url`.
// DIRECT_DATABASE_URL bypasses PgBouncer for migrations; fall back to
// DATABASE_URL when it is not set. The runtime client connects through the
// @prisma/adapter-pg driver adapter in lib/prisma.ts using DATABASE_URL.
//
// process.env is read directly (instead of prisma/config's env()) so that
// `prisma generate` — run from postinstall and Docker builds without a
// database — does not fail when no URL is configured.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL || '',
  },
});
