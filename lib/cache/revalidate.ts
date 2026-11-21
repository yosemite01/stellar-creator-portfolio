import { revalidateTag, revalidatePath } from 'next/cache';
import { CACHE_TAGS, bountyTag, creatorTag, type CacheTag } from './tags';

export type RevalidateProfile = string | { expire?: number };

const DEFAULT_PROFILE: RevalidateProfile = 'max';

/**
 * Trigger Next.js on-demand cache tag revalidation.
 * Uses Next.js 16's two-argument `revalidateTag(tag, profile)` signature.
 */
export async function invalidateCacheTag(
  tag: CacheTag | string,
  profile: RevalidateProfile = DEFAULT_PROFILE,
): Promise<{ revalidated: boolean; tag: string }> {
  try {
    revalidateTag(tag, profile);
    return { revalidated: true, tag };
  } catch (err) {
    console.error(`[Cache] Failed to revalidate tag ${tag}:`, err);
    return { revalidated: false, tag };
  }
}

function safeRevalidate(tag: string, path: string, profile: RevalidateProfile = DEFAULT_PROFILE): void {
  try {
    revalidateTag(tag, profile);
    revalidatePath(path);
  } catch {
    // Non-fatal outside Next.js request lifecycle (e.g., unit tests or background workers).
  }
}

/**
 * Revalidate creators listing and optional creator detail cache.
 */
export async function revalidateCreators(creatorId?: string): Promise<void> {
  safeRevalidate(CACHE_TAGS.creators, '/creators');
  if (creatorId) {
    safeRevalidate(creatorTag(creatorId), `/creators/${creatorId}`);
  }
}

/**
 * Revalidate bounties listing and optional bounty detail cache.
 */
export async function revalidateBounties(bountyId?: string): Promise<void> {
  safeRevalidate(CACHE_TAGS.bounties, '/bounties');
  if (bountyId) {
    safeRevalidate(bountyTag(bountyId), `/bounties/${bountyId}`);
  }
}

/**
 * Revalidate user IPFS files dashboard cache.
 */
export async function revalidateIpfsFiles(): Promise<void> {
  safeRevalidate(CACHE_TAGS.ipfsFiles, '/dashboard/files');
}

/**
 * Revalidate user earnings dashboard cache.
 */
export async function revalidateEarnings(): Promise<void> {
  safeRevalidate(CACHE_TAGS.earnings, '/dashboard/earnings');
}
