// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { hybridSearch, bountyViewSearch } = vi.hoisted(() => ({
  hybridSearch: vi.fn(),
  bountyViewSearch: vi.fn(),
}));
vi.mock('@/server/services/search', () => ({
  hybridSearch,
  bountyViewSearch,
  checkClusterHealth: vi.fn(),
}));

import { POST } from '../route';

function request(body: unknown) {
  return new NextRequest('http://localhost/api/search/hybrid', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  hybridSearch.mockReset();
  hybridSearch.mockResolvedValue([]);
  bountyViewSearch.mockReset();
  bountyViewSearch.mockResolvedValue([]);
});

describe('POST /api/search/hybrid validation', () => {
  const invalid: [string, unknown][] = [
    ['a missing query', {}],
    ['a one character query', { query: 'a' }],
    ['a query over 200 characters', { query: 'x'.repeat(201) }],
    ['a non-string query', { query: { $ne: '' } }],
    ['a non-numeric limit', { query: 'design', limit: 'lots' }],
    ['a negative limit', { query: 'design', limit: -5 }],
    ['an unknown search type', { query: 'design', type: 'everything' }],
    ['skills that are not strings', { query: 'design', skills: [{ a: 1 }] }],
    ['more than 10 skills', { query: 'design', skills: Array.from({ length: 11 }, (_, i) => `s${i}`) }],
    ['verifiedOnly that is not a boolean', { query: 'design', verifiedOnly: 'yes' }],
    ['an unknown bounty status', { query: 'design', type: 'bounty', status: 'DROP TABLE' }],
    ['an unknown filter key', { query: 'design', where: '1=1' }],
    ['a body that is not JSON', 'not json'],
  ];

  it.each(invalid)('returns 400 for %s without searching', async (_name, body) => {
    const res = await POST(request(body));

    expect(res.status).toBe(400);
    expect(hybridSearch).not.toHaveBeenCalled();
    expect(bountyViewSearch).not.toHaveBeenCalled();
  });

  it('returns the field errors', async () => {
    const res = await POST(request({ query: 'a', limit: 'lots' }));
    const { details } = await res.json();
    expect(Object.keys(details.fieldErrors).sort()).toEqual(['limit', 'query']);
  });

  it('clamps an oversized limit', async () => {
    const res = await POST(request({ query: 'design', limit: 100000 }));

    expect(res.status).toBe(200);
    expect(hybridSearch).toHaveBeenCalledWith(expect.objectContaining({ limit: 50 }));
    expect((await res.json()).meta.limit).toBe(50);
  });

  it('accepts a numeric string limit like before', async () => {
    await POST(request({ query: 'design', limit: '20' }));
    expect(hybridSearch).toHaveBeenCalledWith(expect.objectContaining({ limit: 20 }));
  });
});

describe('POST /api/search/hybrid valid requests', () => {
  it('runs a creator search with the filters passed through', async () => {
    hybridSearch.mockResolvedValue([{ id: 'c1' }]);

    const res = await POST(
      request({
        query: ' brand designer ',
        minScore: 0.2,
        discipline: 'design',
        skills: ['figma'],
        verifiedOnly: true,
      }),
    );

    expect(hybridSearch).toHaveBeenCalledWith({
      query: 'brand designer',
      limit: 10,
      minScore: 0.2,
      discipline: 'design',
      skills: ['figma'],
      verifiedOnly: true,
      expandSynonyms: true,
    });
    expect(await res.json()).toEqual({
      results: [{ id: 'c1' }],
      meta: { query: 'brand designer', limit: 10, count: 1, engine: 'hybrid-rrf-v1' },
    });
  });

  it('routes type=bounty to the bounty view', async () => {
    const res = await POST(
      request({ query: 'logo', type: 'bounty', status: 'OPEN', minBudget: 100, tags: ['svg'] }),
    );

    expect(res.status).toBe(200);
    expect(hybridSearch).not.toHaveBeenCalled();
    expect(bountyViewSearch).toHaveBeenCalledWith({
      query: 'logo',
      limit: 10,
      minBudget: 100,
      maxBudget: undefined,
      status: 'OPEN',
      tags: ['svg'],
    });
    expect((await res.json()).meta.engine).toBe('bounty-search-view-v1');
  });
});
