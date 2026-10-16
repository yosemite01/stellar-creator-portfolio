/**
 * Creator ↔ bounty matching service.
 *
 * Connects the pure scoring logic in `lib/matching-engine.ts` to live Prisma
 * data so that:
 *   1. a newly created bounty can be matched against the top-N creators, and
 *   2. those creators receive a `MatchNotification`, and
 *   3. the bounty detail page can render a "Suggested Freelancers" sidebar.
 */

import { prisma } from '@/lib/prisma';
import {
  rankCreatorsForBounty,
  assignStrategy,
  type BountyFeatures,
  type CreatorFeatures,
} from '@/lib/matching-engine';

/** Default number of top creators to surface / notify per bounty. */
export const TOP_MATCHES = 10;

export interface SuggestedCreator {
  profileId: string;
  userId: string;
  displayName: string;
  discipline: string | null;
  skills: string[];
  rating: number;
  /** Match score (0–100). */
  score: number;
  reasons: string[];
}

type BountyRow = {
  id: string;
  title: string;
  description: string;
  budget: number;
  category: string | null;
  tags: string[];
  creatorId: string;
};

function toBountyFeatures(b: BountyRow): BountyFeatures {
  return {
    id: b.id,
    title: b.title,
    description: b.description,
    budget: b.budget,
    category: b.category,
    tags: b.tags,
  };
}

const CREATOR_SELECT = {
  id: true,
  userId: true,
  displayName: true,
  bio: true,
  discipline: true,
  skills: true,
  rating: true,
  completedProjects: true,
} as const;

function toCreatorFeatures(p: {
  id: string;
  userId: string;
  displayName: string;
  bio: string | null;
  discipline: string | null;
  skills: string[];
  rating: number;
  completedProjects: number;
}): CreatorFeatures {
  return {
    profileId: p.id,
    userId: p.userId,
    displayName: p.displayName,
    bio: p.bio,
    discipline: p.discipline,
    skills: p.skills,
    rating: p.rating,
    completedProjects: p.completedProjects,
  };
}

/**
 * Compute the top matching creators for a bounty. Pure read — does not persist
 * anything. Used by the bounty detail "Suggested Freelancers" sidebar.
 */
export async function getSuggestedCreators(
  bountyId: string,
  limit = TOP_MATCHES,
): Promise<SuggestedCreator[]> {
  const bounty = (await prisma.bounty.findUnique({
    where: { id: bountyId },
    select: {
      id: true,
      title: true,
      description: true,
      budget: true,
      category: true,
      tags: true,
      creatorId: true,
    },
  })) as BountyRow | null;
  if (!bounty) return [];

  const profiles = await prisma.creatorProfile.findMany({ select: CREATOR_SELECT });
  const strategy = assignStrategy(bounty.creatorId);

  return rankCreatorsForBounty(
    toBountyFeatures(bounty),
    profiles.map(toCreatorFeatures),
    strategy,
    limit,
  ).map(({ creator, breakdown }) => ({
    profileId: creator.profileId,
    userId: creator.userId,
    displayName: creator.displayName,
    discipline: creator.discipline,
    skills: creator.skills,
    rating: creator.rating,
    score: Math.round(breakdown.score),
    reasons: breakdown.reasons,
  }));
}

/**
 * Run matching for a freshly created bounty and notify the top creators via a
 * `MatchNotification`. Returns the ranked suggestions.
 */
export async function matchCreatorsForBounty(
  bountyId: string,
  limit = TOP_MATCHES,
): Promise<SuggestedCreator[]> {
  const suggestions = await getSuggestedCreators(bountyId, limit);
  if (suggestions.length === 0) return suggestions;

  const bounty = await prisma.bounty.findUnique({
    where: { id: bountyId },
    select: { title: true },
  });
  const title = bounty?.title ?? 'a bounty';

  await prisma.matchNotification.createMany({
    data: suggestions.map((s) => ({
      userId: s.userId,
      title: `You're a strong match for "${title}"`,
      body: `${s.score}% match. ${s.reasons[0] ?? 'Your skills line up with this bounty.'}`,
      relatedBountyId: bountyId,
    })),
  });

  return suggestions;
}

/**
 * Validate that an ID looks like a valid bounty identifier.
 * Deny-by-default: must be an alphanumeric/hyphen/underscore string between 1 and 128 characters,
 * with no leading/trailing whitespace, control characters, or path separators.
 */
export function isValidBountyId(id: unknown): id is string {
  if (typeof id !== 'string') return false;
  const trimmed = id.trim();
  if (!trimmed || trimmed !== id) return false;
  return /^[a-zA-Z0-9_-]{1,128}$/.test(id);
}

export type BountyAccessErrorStatus = 400 | 401 | 403 | 404;

export type BountyAccessResult =
  | { authorized: true; bounty: { id: string; creatorId: string } }
  | { authorized: false; status: BountyAccessErrorStatus; error: string };

export interface SessionUserLike {
  id?: string;
  role?: string;
}

export interface SessionLike {
  user?: SessionUserLike | null;
}

/**
 * Verifies that the request has an active session and that the user is either
 * the creator/owner of the bounty or an administrator.
 */
export async function verifyBountyOwnerOrAdmin(
  bountyId: unknown,
  session: SessionLike | null | undefined,
): Promise<BountyAccessResult> {
  if (!session?.user?.id) {
    return {
      authorized: false,
      status: 401,
      error: 'Unauthorized',
    };
  }

  if (!isValidBountyId(bountyId)) {
    return {
      authorized: false,
      status: 400,
      error: 'Invalid bounty id',
    };
  }

  const bounty = await prisma.bounty.findUnique({
    where: { id: bountyId },
    select: { id: true, creatorId: true },
  });

  if (!bounty) {
    return {
      authorized: false,
      status: 404,
      error: 'Bounty not found',
    };
  }

  const isOwner = bounty.creatorId === session.user.id;
  const isAdmin = typeof session.user.role === 'string' && session.user.role.toUpperCase() === 'ADMIN';

  if (!isOwner && !isAdmin) {
    return {
      authorized: false,
      status: 403,
      error: 'Forbidden',
    };
  }

  return {
    authorized: true,
    bounty,
  };
}
