export const CACHE_TAGS = {
  creators: 'creators',
  bounties: 'bounties',
  ipfsFiles: 'ipfs-files',
  earnings: 'earnings',
} as const;

export type CacheTag = (typeof CACHE_TAGS)[keyof typeof CACHE_TAGS];

export function creatorTag(id: string): string {
  return `creator-${id}`;
}

export function bountyTag(id: string): string {
  return `bounty-${id}`;
}

const DYNAMIC_TAG_RE = /^(creator|bounty)-[a-zA-Z0-9_-]{1,64}$/;

export function isAllowedCacheTag(tag: string): boolean {
  const staticTags = Object.values(CACHE_TAGS) as readonly string[];
  return staticTags.includes(tag) || DYNAMIC_TAG_RE.test(tag);
}
