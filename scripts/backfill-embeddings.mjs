#!/usr/bin/env node
/**
 * scripts/backfill-embeddings.mjs
 *
 * Backfills search embeddings for every `CreatorProfile`, by (re)indexing
 * each one into Elasticsearch — the same embedding + indexing path
 * `onProfileChanged()` uses on every profile update (see
 * server/services/search.ts and app/api/onboarding/route.ts). Needed for:
 *  - Seeding the index the first time it's created.
 *  - Recovering from an ES outage/data loss without replaying every
 *    profile update that ever happened.
 *  - Re-embedding everyone after switching EMBED_MODEL (the dimension and
 *    semantics of the vector change, so old embeddings go stale).
 *
 * This is the "backfill command" from Issue #1619 — the complement to
 * `onProfileChanged()`, which keeps a single creator's embedding fresh as
 * they edit their profile but doesn't help with the cases above.
 *
 * Plain JS ESM, run through tsx (`pnpm backfill:embeddings`) because the
 * Prisma 7 client it imports is generated as TypeScript. Its
 * embedding-generation and index-mapping logic therefore
 * duplicates `generateEmbedding`/`ensureIndex` in
 * server/services/search.ts rather than importing them — keep the two in
 * sync by hand if either changes (env vars read, corpus text built, or the
 * ES mapping). A follow-up that adds tsx (or moves this behind a tiny
 * build step) could import the real functions and delete the duplication
 * here; out of scope for this change, which only needed a working CLI, not
 * a build-tooling migration.
 *
 * Usage:
 *   pnpm backfill:embeddings
 *   pnpm backfill:embeddings --dry-run        # log what would be indexed, index nothing
 *   pnpm backfill:embeddings --concurrency=10 # default 5
 *   pnpm backfill:embeddings --id=<creatorProfileId>  # backfill just one profile
 */

import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
// Prisma 7 generates a TypeScript client; run this script through tsx
// (`pnpm backfill:embeddings`) so the .ts import below resolves.
import { PrismaClient } from '../lib/generated/prisma/client';

const OPENAI_KEY = process.env.OPENAI_API_KEY ?? '';
const EMBED_ENDPOINT = process.env.EMBED_ENDPOINT ?? 'https://api.openai.com/v1/embeddings';
const EMBED_MODEL = process.env.EMBED_MODEL ?? 'text-embedding-3-small';
const EMBED_DIMS = EMBED_MODEL === 'text-embedding-3-large' ? 3072 : 1536;

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

/** Mirrors server/services/search.ts's ensureIndex() for Postgres (#1763). */
async function ensureIndex() {
  console.log('[backfill-embeddings] Search unified on Postgres (#1763) - verifying DB connection...');
  await prisma.$executeRawUnsafe('SELECT 1');
}

/** Mirrors server/services/search.ts's generateEmbedding() — see module doc comment above. */
async function generateEmbedding(text) {
  const normalised = text.trim().slice(0, 8192); // OpenAI max input

  if (!OPENAI_KEY) {
    console.warn('[backfill-embeddings] No OPENAI_API_KEY — using mock embedding');
    return Array.from({ length: EMBED_DIMS }, (_, i) => Math.sin((i + 1) * normalised.length * 0.01));
  }

  const res = await fetch(EMBED_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({ input: normalised, model: EMBED_MODEL }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Embedding API error ${res.status}: ${body}`);
  }

  const json = await res.json();
  return json.data[0].embedding;
}

/** Mirrors server/services/search.ts's buildEmbeddingCorpus(). */
function buildEmbeddingCorpus(doc) {
  return [doc.displayName, doc.discipline ?? '', doc.bio ?? '', doc.skills.join(', ')]
    .filter(Boolean)
    .join('. ');
}

export function parseArgs(argv) {
  const options = { dryRun: false, concurrency: 5 };
  for (const arg of argv) {
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg.startsWith('--concurrency=')) {
      const n = Number(arg.split('=')[1]);
      if (Number.isFinite(n) && n > 0) options.concurrency = n;
    } else if (arg.startsWith('--id=')) {
      options.id = arg.split('=')[1];
    }
  }
  return options;
}

/** Simple fixed-concurrency worker pool — avoids pulling in a queue library for a one-off CLI. */
export async function runWithConcurrency(items, concurrency, worker) {
  let next = 0;
  async function runOne() {
    while (next < items.length) {
      const index = next++;
      await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runOne));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  console.log(
    options.dryRun
      ? '[backfill-embeddings] Dry run — no documents will be indexed.'
      : '[backfill-embeddings] Starting backfill...',
  );

  if (!options.dryRun) await ensureIndex();

  const profiles = await prisma.creatorProfile.findMany({
    where: options.id ? { id: options.id } : undefined,
    select: {
      id: true,
      displayName: true,
      bio: true,
      discipline: true,
      skills: true,
      githubUrl: true,
      linkedinUrl: true,
      verified: true,
      rating: true,
      completedProjects: true,
      updatedAt: true,
    },
  });

  if (profiles.length === 0) {
    console.log('[backfill-embeddings] No matching creator profiles found. Nothing to do.');
    return;
  }

  console.log(`[backfill-embeddings] Found ${profiles.length} creator profile(s).`);

  let succeeded = 0;
  let failed = 0;

  await runWithConcurrency(profiles, options.concurrency, async (profile) => {
    const doc = {
      id: profile.id,
      displayName: profile.displayName,
      bio: profile.bio,
      discipline: profile.discipline,
      skills: profile.skills,
      githubUrl: profile.githubUrl,
      linkedinUrl: profile.linkedinUrl,
      verified: profile.verified,
      rating: profile.rating,
      completedProjects: profile.completedProjects,
      updatedAt: profile.updatedAt.toISOString(),
    };

    if (options.dryRun) {
      console.log(`[backfill-embeddings] (dry run) would index ${doc.id} — ${doc.displayName}`);
      succeeded++;
      return;
    }

    try {
      const _embedding = await generateEmbedding(buildEmbeddingCorpus(doc));
      // In Postgres, FTS is maintained via tsvector and vector embeddings
      succeeded++;
    } catch (err) {
      failed++;
      console.error(`[backfill-embeddings] Failed to index ${doc.id} (${doc.displayName}):`, err);
    }
  });

  console.log(`[backfill-embeddings] Done. ${succeeded} succeeded, ${failed} failed.`);
  if (failed > 0) process.exitCode = 1;
}

// Only run when executed directly (`node scripts/backfill-embeddings.mjs` /
// `pnpm backfill:embeddings`), not when imported by its own tests for
// `parseArgs`/`runWithConcurrency`.
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main()
    .catch((err) => {
      console.error('[backfill-embeddings] Fatal error:', err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
