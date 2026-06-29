import { creators, type Creator } from '@/lib/services/creators-data';

const CHUNK_DELAY_MS = 0;

async function delay(ms: number) {
  if (ms <= 0) return;
  await new Promise((r) => setTimeout(r, ms));
}

export async function fetchCreatorCore(id: string): Promise<Creator | null> {
  await delay(CHUNK_DELAY_MS);
  return creators.find((c) => c.id === id) ?? null;
}

export async function fetchCreatorBio(id: string): Promise<{ bio: string; tagline: string; skills: string[] } | null> {
  await delay(CHUNK_DELAY_MS);
  const creator = creators.find((c) => c.id === id);
  if (!creator) return null;
  return { bio: creator.bio, tagline: creator.tagline, skills: creator.skills };
}

export async function fetchCreatorProjects(id: string) {
  await delay(CHUNK_DELAY_MS);
  const creator = creators.find((c) => c.id === id);
  return creator?.projects ?? [];
}

export async function fetchCreatorSocial(id: string) {
  await delay(CHUNK_DELAY_MS);
  const creator = creators.find((c) => c.id === id);
  if (!creator) return null;
  return { linkedIn: creator.linkedIn, twitter: creator.twitter, name: creator.name, title: creator.title, discipline: creator.discipline };
}

export async function fetchBountiesHeader() {
  await delay(CHUNK_DELAY_MS);
  return { total: 42, active: 28, totalBudget: 125000 };
}

export async function fetchBountiesList() {
  await delay(CHUNK_DELAY_MS);
  const { bounties } = await import('@/lib/creators-data');
  return bounties;
}

export async function fetchBountiesStats() {
  await delay(CHUNK_DELAY_MS);
  return { categories: 8, avgBudget: 3200, completionRate: 0.87 };
}
