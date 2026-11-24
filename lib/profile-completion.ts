export interface CreatorProfileFields {
  displayName?: string | null;
  avatar?: string | null;
  bio?: string | null;
  skills?: string[];
  portfolio?: unknown;
  githubUrl?: string | null;
  linkedinUrl?: string | null;
  verified?: boolean;
}

export interface ProfileCompletionField {
  key: string;
  label: string;
  weight: number;
  complete: boolean;
  href: string;
}

export interface ProfileCompletionResult {
  percentage: number;
  fields: ProfileCompletionField[];
  missing: ProfileCompletionField[];
}

/**
 * Profile event types that trigger a server-side completion recompute.
 * Every state change on a profile must emit one of these so the persisted
 * score stays authoritative (see issue #1825).
 */
export type ProfileEventType =
  | 'profile.created'
  | 'profile.updated'
  | 'profile.verified';

export interface ProfileEvent {
  type: ProfileEventType;
  profileId: string;
  profile: CreatorProfileFields;
}

/**
 * Persisted, server-computed completion snapshot. This is the shape stored
 * alongside the profile and consumed by matching/ranking and nudges.
 */
export interface ProfileCompletionSnapshot {
  profileId: string;
  percentage: number;
  missingKeys: string[];
  computedAt: string;
}

/**
 * A nudge notification derived from a profile event when completion is
 * incomplete. `dedupeKey` lets the notification layer avoid re-sending the
 * same nudge for the same missing field.
 */
export interface ProfileCompletionNudge {
  profileId: string;
  dedupeKey: string;
  percentage: number;
  missingKeys: string[];
  message: string;
}

/** Completion percentage at or above which no nudge is emitted. */
export const PROFILE_COMPLETION_NUDGE_THRESHOLD = 100;

function hasPortfolioItem(portfolio: unknown): boolean {
  if (!portfolio) return false;
  if (Array.isArray(portfolio)) return portfolio.length > 0;
  if (typeof portfolio === 'object' && portfolio !== null) {
    const obj = portfolio as Record<string, unknown>;
    if (Array.isArray(obj.items)) return obj.items.length > 0;
    if (Array.isArray(obj.sections)) return obj.sections.length > 0;
    return Object.keys(obj).length > 0;
  }
  return false;
}

export function computeProfileCompletion(
  profile: CreatorProfileFields,
): ProfileCompletionResult {
  const checks: ProfileCompletionField[] = [
    {
      key: 'displayName',
      label: 'Display name',
      weight: 10,
      complete: !!profile.displayName && profile.displayName.length >= 2,
      href: '/profile/edit#displayName',
    },
    {
      key: 'avatar',
      label: 'Profile photo',
      weight: 15,
      complete: !!profile.avatar,
      href: '/profile/edit#avatar',
    },
    {
      key: 'bio',
      label: 'Bio',
      weight: 20,
      complete: !!profile.bio && profile.bio.trim().length > 0,
      href: '/profile/edit#bio',
    },
    {
      key: 'skills',
      label: '3+ skills',
      weight: 15,
      complete: (profile.skills?.length ?? 0) >= 3,
      href: '/profile/edit#skills',
    },
    {
      key: 'portfolio',
      label: 'Portfolio sample',
      weight: 25,
      complete: hasPortfolioItem(profile.portfolio),
      href: '/profile/edit#portfolio',
    },
    {
      key: 'social',
      label: 'GitHub or LinkedIn',
      weight: 10,
      complete: !!(profile.githubUrl || profile.linkedinUrl),
      href: '/profile/edit#social',
    },
    {
      key: 'verified',
      label: 'Verified account',
      weight: 5,
      complete: !!profile.verified,
      href: '/profile/edit#verification',
    },
  ];

  const percentage = checks.reduce(
    (sum, field) => sum + (field.complete ? field.weight : 0),
    0,
  );

  const missing = checks.filter((f) => !f.complete);

  return { percentage, fields: checks, missing };
}

/**
 * Server-side entry point: recompute the completion snapshot for a profile
 * event. Call this from the profile create/update handlers so the persisted
 * score is authoritative rather than computed client-side.
 */
export function computeCompletionSnapshot(
  event: ProfileEvent,
  now: Date = new Date(),
): ProfileCompletionSnapshot {
  const result = computeProfileCompletion(event.profile);
  return {
    profileId: event.profileId,
    percentage: result.percentage,
    missingKeys: result.missing.map((f) => f.key),
    computedAt: now.toISOString(),
  };
}

/**
 * Derive a nudge notification from a profile event when completion is
 * incomplete. Returns null when the profile is complete so callers can skip
 * enqueueing a notification.
 */
export function buildCompletionNudge(
  event: ProfileEvent,
): ProfileCompletionNudge | null {
  const result = computeProfileCompletion(event.profile);
  if (result.percentage >= PROFILE_COMPLETION_NUDGE_THRESHOLD) return null;

  const missingKeys = result.missing.map((f) => f.key);
  const next = result.missing[0];
  const message = next
    ? `Your profile is ${result.percentage}% complete. Add ${next.label.toLowerCase()} to finish it.`
    : `Your profile is ${result.percentage}% complete.`;

  return {
    profileId: event.profileId,
    dedupeKey: `profile-completion:${event.profileId}:${missingKeys.join(',')}`,
    percentage: result.percentage,
    missingKeys,
    message,
  };
}

/**
 * Ranking weight derived from the server-computed completion score. Matching
 * should read the persisted snapshot rather than recomputing client-side.
 */
export function completionRankingWeight(
  snapshot: Pick<ProfileCompletionSnapshot, 'percentage'>,
): number {
  const clamped = Math.max(0, Math.min(100, snapshot.percentage));
  return clamped / 100;
}
