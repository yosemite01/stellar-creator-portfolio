import type { Prisma } from '@/lib/generated/prisma/client';
import type { Creator } from '@/lib/services/creators-data';

/** Columns of CreatorProfile needed to render a creator card. */
export const creatorCardSelect = {
  id: true,
  displayName: true,
  discipline: true,
  bio: true,
  avatar: true,
  skills: true,
  rating: true,
  completedProjects: true,
  linkedinUrl: true,
  websiteUrl: true,
} satisfies Prisma.CreatorProfileSelect;

type CreatorCardRow = Prisma.CreatorProfileGetPayload<{ select: typeof creatorCardSelect }>;

/**
 * Maps a CreatorProfile row onto the `Creator` shape the card and directory
 * components render. Fields the profile doesn't store yet (client count,
 * years of experience, hourly rate, review count) are reported as zero or
 * left unset rather than invented.
 */
export function toCreator(profile: CreatorCardRow): Creator {
  return {
    id: profile.id,
    name: profile.displayName,
    title: profile.discipline || 'Creator',
    discipline: profile.discipline || 'General',
    bio: profile.bio || '',
    avatar: profile.avatar || '/avatars/default.jpg',
    coverImage: '/covers/default.jpg',
    tagline: 'Available for projects',
    linkedIn: profile.linkedinUrl || '',
    twitter: '',
    portfolio: profile.websiteUrl || '',
    projects: [],
    skills: profile.skills,
    stats: {
      projects: profile.completedProjects,
      clients: 0,
      experience: 0,
    },
    rating: profile.rating,
    reviewCount: 0,
  };
}
