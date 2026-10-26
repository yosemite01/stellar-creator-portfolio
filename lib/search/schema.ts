/**
 * Request schemas shared by the search routes (#1511, #1512).
 *
 * Threat closed: unvalidated bodies let a caller send huge queries, an
 * unbounded `limit` or unexpected types, which means paid embedding calls
 * and heavy database queries on demand.  Schemas are strict, so unknown keys
 * are rejected, and `limit` is clamped rather than passed through.
 */

import { z } from 'zod';

export const SEARCH_QUERY_MIN_LENGTH = 2;
export const SEARCH_QUERY_MAX_LENGTH = 200;
export const SEARCH_LIMIT_DEFAULT = 10;
export const SEARCH_LIMIT_MAX = 50;
export const SEARCH_MAX_TAGS = 10;

const tag = z.string().trim().min(1).max(50);

/** Fields every search route accepts. */
export const searchQuerySchema = z.object({
  query: z.string().trim().min(SEARCH_QUERY_MIN_LENGTH).max(SEARCH_QUERY_MAX_LENGTH),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .transform((n) => Math.min(n, SEARCH_LIMIT_MAX))
    .default(SEARCH_LIMIT_DEFAULT),
});

/** POST /api/search/vector */
export const vectorSearchSchema = searchQuerySchema
  .extend({
    threshold: z.number().min(0).max(1).default(0.5),
    tags: z.array(tag).max(SEARCH_MAX_TAGS).default([]),
  })
  .strict();

/** POST /api/search/hybrid (creator and bounty modes). */
export const hybridSearchSchema = searchQuerySchema
  .extend({
    type: z.enum(['creator', 'bounty']).default('creator'),
    // creator filters
    minScore: z.number().min(0).optional(),
    discipline: z.string().trim().min(1).max(100).optional(),
    skills: z.array(tag).max(SEARCH_MAX_TAGS).optional(),
    verifiedOnly: z.boolean().optional(),
    expandSynonyms: z.boolean().optional(),
    // bounty filters
    minBudget: z.number().min(0).optional(),
    maxBudget: z.number().min(0).optional(),
    status: z.enum(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
    tags: z.array(tag).max(SEARCH_MAX_TAGS).optional(),
  })
  .strict();
