/**
 * Profile Events and Server-Side Completion Scoring Service (Issue #1825)
 *
 * Computes, persists, and monitors profile completion scores across user lifecycle events.
 * Manages event-driven score recalculations, matching ranking sync, and automated nudge notifications.
 */

import { prisma as defaultPrisma } from '@/lib/prisma';
import {
  computeProfileCompletion,
  type ProfileCompletionResult,
  type CreatorProfileFields,
} from '@/lib/profile-completion';

export type ProfileEventType =
  | 'profile.created'
  | 'profile.updated'
  | 'avatar.uploaded'
  | 'skills.updated'
  | 'portfolio.updated'
  | 'socials.linked'
  | 'verification.updated';

export interface ProfileEvent {
  type: ProfileEventType;
  userId: string;
  timestamp?: Date;
  metadata?: Record<string, unknown>;
}

export const PROFILE_NUDGE_COOLDOWN_DAYS = 7;
export const PROFILE_NUDGE_THRESHOLD = 80;

export interface NudgeEvaluation {
  shouldNudge: boolean;
  reason?: string;
  notificationId?: string;
  missingFields: string[];
  currentScore: number;
}

export interface ProfileSyncResult extends ProfileCompletionResult {
  userId: string;
  profileId?: string;
  updated: boolean;
}

/**
 * Recalculates and persists completionScore for a creator's profile in the database.
 */
export async function syncCreatorProfileCompletion(
  userId: string,
  client: any = defaultPrisma,
): Promise<ProfileSyncResult> {
  const profile = await client.creatorProfile.findUnique({
    where: { userId },
    select: {
      id: true,
      userId: true,
      displayName: true,
      avatar: true,
      bio: true,
      skills: true,
      portfolio: true,
      githubUrl: true,
      linkedinUrl: true,
      verified: true,
      completionScore: true,
    },
  });

  if (!profile) {
    const emptyResult = computeProfileCompletion({});
    return {
      ...emptyResult,
      userId,
      updated: false,
    };
  }

  const completion = computeProfileCompletion(profile as CreatorProfileFields);

  let updated = false;
  if (profile.completionScore !== completion.percentage) {
    await client.creatorProfile.update({
      where: { userId },
      data: { completionScore: completion.percentage },
    });
    updated = true;
  }

  return {
    ...completion,
    userId,
    profileId: profile.id,
    updated,
  };
}

/**
 * Evaluates whether a creator should receive a nudge notification for an incomplete profile,
 * respecting the 7-day cooldown window.
 */
export async function checkAndSendProfileNudge(
  userId: string,
  completion: ProfileCompletionResult,
  client: any = defaultPrisma,
): Promise<NudgeEvaluation> {
  // If profile is already at or above threshold, no nudge needed
  if (completion.percentage >= PROFILE_NUDGE_THRESHOLD) {
    return {
      shouldNudge: false,
      reason: 'Profile meets or exceeds completeness threshold',
      missingFields: [],
      currentScore: completion.percentage,
    };
  }

  const cooldownDate = new Date(Date.now() - PROFILE_NUDGE_COOLDOWN_DAYS * 86_400_000);

  // Check if a nudge was already sent within the cooldown window
  const existingNudge = await client.notification.findFirst({
    where: {
      userId,
      type: 'profile_nudge',
      createdAt: { gte: cooldownDate },
    },
    select: { id: true, createdAt: true },
  });

  if (existingNudge) {
    return {
      shouldNudge: false,
      reason: 'Nudge cooldown period active',
      missingFields: completion.missing.map((f) => f.key),
      currentScore: completion.percentage,
    };
  }

  // Construct personalized nudge message highlighting top 2 missing high-weight items
  const missingItems = completion.missing.slice(0, 2).map((m) => m.label).join(' and ');
  const messageBody = missingItems
    ? `Your profile is at ${completion.percentage}%. Add ${missingItems} to boost your visibility and rank higher for bounties.`
    : `Your profile is at ${completion.percentage}%. Complete missing details to improve client matching.`;

  const notification = await client.notification.create({
    data: {
      userId,
      title: 'Complete your profile to unlock more opportunities',
      body: messageBody,
      type: 'profile_nudge',
      priority: 'normal',
      channels: ['in_app'],
      metadata: {
        completionScore: completion.percentage,
        missingKeys: completion.missing.map((f) => f.key),
      },
    },
  });

  return {
    shouldNudge: true,
    notificationId: notification.id,
    missingFields: completion.missing.map((f) => f.key),
    currentScore: completion.percentage,
  };
}

/**
 * Handles incoming profile domain events: updates completion score and evaluates nudges.
 */
export async function handleProfileEvent(
  event: ProfileEvent,
  client: any = defaultPrisma,
): Promise<{
  completion: ProfileSyncResult;
  nudge: NudgeEvaluation;
}> {
  const completion = await syncCreatorProfileCompletion(event.userId, client);
  const nudge = await checkAndSendProfileNudge(event.userId, completion, client);

  return {
    completion,
    nudge,
  };
}

/**
 * Batch evaluates creators who may need nudges (e.g. for scheduled cron sweep).
 */
export async function batchEvaluateProfileNudges(
  options: {
    limit?: number;
    threshold?: number;
  } = {},
  client: any = defaultPrisma,
): Promise<{ evaluated: number; nudged: number }> {
  const { limit = 50, threshold = PROFILE_NUDGE_THRESHOLD } = options;

  const creators = await client.creatorProfile.findMany({
    where: {
      completionScore: { lt: threshold },
    },
    take: limit,
    select: {
      userId: true,
      displayName: true,
      avatar: true,
      bio: true,
      skills: true,
      portfolio: true,
      githubUrl: true,
      linkedinUrl: true,
      verified: true,
      completionScore: true,
    },
  });

  let nudgedCount = 0;

  for (const creator of creators) {
    const completion = computeProfileCompletion(creator as CreatorProfileFields);
    const evalResult = await checkAndSendProfileNudge(creator.userId, completion, client);
    if (evalResult.shouldNudge) {
      nudgedCount++;
    }
  }

  return {
    evaluated: creators.length,
    nudged: nudgedCount,
  };
}
