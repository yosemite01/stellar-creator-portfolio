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
