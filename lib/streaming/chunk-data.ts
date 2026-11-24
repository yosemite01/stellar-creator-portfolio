import { cache } from 'react';
import { creators, type Creator } from '@/lib/services/creators-data';

const CHUNK_DELAY_MS = 0;

async function delay(ms: number) {
  if (ms <= 0) return;
  await new Promise((r) => setTimeout(r, ms));
}

// Every fetcher is wrapped in React `cache()` so sections that need the same
// record (e.g. the hero and the CTA both read the creator's social links)
// share one lookup per request instead of issuing it once per boundary.

export const fetchCreatorCore = cache(async (id: string): Promise<Creator | null> => {
  await delay(CHUNK_DELAY_MS);
  return creators.find((c) => c.id === id) ?? null;
});

export const fetchCreatorBio = cache(
  async (id: string): Promise<{ bio: string; tagline: string; skills: string[] } | null> => {
    await delay(CHUNK_DELAY_MS);
    const creator = creators.find((c) => c.id === id);
    if (!creator) return null;
    return { bio: creator.bio, tagline: creator.tagline, skills: creator.skills };
  },
);

export const fetchCreatorProjects = cache(async (id: string) => {
  await delay(CHUNK_DELAY_MS);
  const creator = creators.find((c) => c.id === id);
  return creator?.projects ?? [];
});

export const fetchCreatorSocial = cache(async (id: string) => {
  await delay(CHUNK_DELAY_MS);
  const creator = creators.find((c) => c.id === id);
  if (!creator) return null;
  return { linkedIn: creator.linkedIn, twitter: creator.twitter, name: creator.name, title: creator.title, discipline: creator.discipline };
});

export const fetchBountiesHeader = cache(async () => {
  await delay(CHUNK_DELAY_MS);
  return { total: 42, active: 28, totalBudget: 125000 };
});

export const fetchBountiesList = cache(async () => {
  await delay(CHUNK_DELAY_MS);
  const { bounties } = await import('@/lib/services/creators-data');
  return bounties;
});

export const fetchBountiesStats = cache(async () => {
  await delay(CHUNK_DELAY_MS);
  return { categories: 8, avgBudget: 3200, completionRate: 0.87 };
});

export const fetchCreatorsList = cache(async (discipline?: string): Promise<Creator[]> => {
  await delay(CHUNK_DELAY_MS);
  const { creators } = await import('@/lib/services/creators-data');
  if (!discipline || discipline === 'All') return creators;
  return creators.filter((c) => c.discipline.toLowerCase() === discipline.toLowerCase());
});
