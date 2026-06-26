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
