import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchCreatorsList } from '@/lib/streaming/chunk-data';
import { CACHE_TAGS, creatorTag, bountyTag, isAllowedCacheTag } from '@/lib/cache/tags';
import { invalidateCacheTag, revalidateCreators, revalidateBounties } from '@/lib/cache/revalidate';
import { POST as revalidateRoute } from '@/app/api/revalidate/route';
import { NextRequest } from 'next/server';

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/auth/auth', () => ({
  getServerSession: vi.fn().mockResolvedValue(null),
}));

describe('RSC Migration Data Fetchers', () => {
  it('fetchCreatorsList retrieves full creators list', async () => {
    const list = await fetchCreatorsList();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThan(0);
  });

  it('fetchCreatorsList filters correctly by discipline', async () => {
    const all = await fetchCreatorsList('All');
    const design = await fetchCreatorsList('Design');
    expect(design.length).toBeLessThanOrEqual(all.length);
    for (const c of design) {
      expect(c.discipline.toLowerCase()).toBe('design');
    }
  });

  it('invalidateCacheTag successfully triggers revalidation', async () => {
    const res = await invalidateCacheTag(CACHE_TAGS.creators);
    expect(res.revalidated).toBe(true);
    expect(res.tag).toBe(CACHE_TAGS.creators);
  });
});

describe('Revalidation API Route Boundary & Security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.REVALIDATION_SECRET;
  });

  it('rejects unauthenticated requests without secret', async () => {
    const req = new NextRequest('http://localhost:3000/api/revalidate', {
      method: 'POST',
      body: JSON.stringify({ tag: 'creators' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await revalidateRoute(req);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe('Unauthorized');
  });

  it('rejects malformed requests (invalid zod schema)', async () => {
    const req = new NextRequest('http://localhost:3000/api/revalidate', {
      method: 'POST',
      body: JSON.stringify({ tag: '' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await revalidateRoute(req);
    expect(res.status).toBe(400);
  });

  it('rejects unknown cache tags (negative security test)', async () => {
    process.env.REVALIDATION_SECRET = 'supersecret';
    const req = new NextRequest('http://localhost:3000/api/revalidate', {
      method: 'POST',
      body: JSON.stringify({ tag: 'malicious-injected-tag', secret: 'supersecret' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await revalidateRoute(req);
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toBe('Invalid or unknown cache tag');
  });

  it('successfully revalidates with valid secret and tag', async () => {
    process.env.REVALIDATION_SECRET = 'supersecret';
    const req = new NextRequest('http://localhost:3000/api/revalidate', {
      method: 'POST',
      body: JSON.stringify({ tag: 'creators', secret: 'supersecret' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await revalidateRoute(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.revalidated).toBe(true);
    expect(data.tag).toBe('creators');
  });

  it('rejects dynamic tags containing path traversal or invalid characters', async () => {
    process.env.REVALIDATION_SECRET = 'supersecret';
    expect(isAllowedCacheTag(creatorTag('alice_1'))).toBe(true);
    expect(isAllowedCacheTag(bountyTag('bounty-42'))).toBe(true);
    expect(isAllowedCacheTag('creator-../../etc')).toBe(false);

    const req = new NextRequest('http://localhost:3000/api/revalidate', {
      method: 'POST',
      body: JSON.stringify({ tag: 'creator-../admin', secret: 'supersecret' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await revalidateRoute(req);
    expect(res.status).toBe(422);
  });

  it('triggers both listing and detail revalidation on entity mutations', async () => {
    await revalidateCreators('creator-1');
    await revalidateBounties('bounty-1');
    const cache = await import('next/cache');
    expect(cache.revalidateTag).toHaveBeenCalledWith(CACHE_TAGS.creators, 'max');
    expect(cache.revalidateTag).toHaveBeenCalledWith('creator-creator-1', 'max');
    expect(cache.revalidateTag).toHaveBeenCalledWith(CACHE_TAGS.bounties, 'max');
    expect(cache.revalidateTag).toHaveBeenCalledWith('bounty-bounty-1', 'max');
  });
});
