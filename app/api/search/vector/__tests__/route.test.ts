// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// The route reads the key when it is first imported, so set it first.
vi.hoisted(() => {
  process.env.OPENAI_API_KEY = 'test-key';
});

const { getServerSession, rpc } = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock('@/lib/auth/auth', () => ({ getServerSession }));
vi.mock('@/lib/db', () => ({ supabaseServer: { rpc, from: vi.fn() } }));

import { POST } from '../route';
import { clearEmbeddingCache } from '@/lib/search/embeddingCache';

let ipCounter = 0;
let ip: string;
let fetchMock: ReturnType<typeof vi.fn>;

function request(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/search/vector', {
    method: 'POST',
    headers: { 'x-forwarded-for': ip, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** Number of calls that reached the embeddings endpoint (i.e. cost money). */
const embedCalls = () => fetchMock.mock.calls.length;

beforeEach(() => {
  // Each test gets its own IP so rate-limit buckets do not leak between tests.
  ip = `203.0.113.${++ipCounter}`;
  clearEmbeddingCache();
  getServerSession.mockReset();
  getServerSession.mockResolvedValue(null);
  rpc.mockReset();
  rpc.mockResolvedValue({ data: [], error: null });
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /api/search/vector rate limiting', () => {
  it('returns 429 for an anonymous IP after 30 requests, without calling the embeddings API', async () => {
    for (let i = 0; i < 30; i++) {
      expect((await POST(request({ query: `creator ${i}` }))).status).toBe(200);
    }
    expect(embedCalls()).toBe(30);

    const res = await POST(request({ query: 'one too many' }));

    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(embedCalls()).toBe(30);
  });

  it('gives signed-in users a higher limit than anonymous callers', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'user-1' } });
    for (let i = 0; i < 31; i++) {
      expect((await POST(request({ query: `creator ${i}` }))).status).toBe(200);
    }
  });
});

describe('POST /api/search/vector validation', () => {
  const invalid: [string, unknown][] = [
    ['a missing query', {}],
    ['a one character query', { query: 'a' }],
    ['a query over 200 characters', { query: 'x'.repeat(201) }],
    ['a non-string query', { query: 42 }],
    ['a non-numeric limit', { query: 'design', limit: 'lots' }],
    ['a limit of zero', { query: 'design', limit: 0 }],
    ['a threshold above 1', { query: 'design', threshold: 2 }],
    ['more than 10 tags', { query: 'design', tags: Array.from({ length: 11 }, (_, i) => `t${i}`) }],
    ['tags that are not strings', { query: 'design', tags: [1, 2] }],
    ['an unknown key', { query: 'design', matchCount: 5 }],
    ['a body that is not JSON', 'not json'],
  ];

  it.each(invalid)('returns 400 for %s without calling the embeddings API', async (_name, body) => {
    const res = await POST(request(body));

    expect(res.status).toBe(400);
    expect(embedCalls()).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns the field errors', async () => {
    const res = await POST(request({ query: 'a' }));
    const { details } = await res.json();
    expect(details.fieldErrors.query).toBeDefined();
  });

  it('clamps an oversized limit before it reaches the database', async () => {
    const res = await POST(request({ query: 'design', limit: 100000 }));

    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('match_creators', expect.objectContaining({ match_count: 50 }));
  });

  it('applies the defaults for limit and threshold', async () => {
    await POST(request({ query: 'design' }));
    expect(rpc).toHaveBeenCalledWith(
      'match_creators',
      expect.objectContaining({ match_count: 10, match_threshold: 0.5 }),
    );
  });

  it('still filters results by tag', async () => {
    rpc.mockResolvedValue({
      data: [
        { id: 'a', skills: ['figma'], discipline: 'design' },
        { id: 'b', skills: ['rust'], discipline: 'engineering' },
      ],
      error: null,
    });

    const res = await POST(request({ query: 'design', tags: ['Figma'] }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { id: 'a', skills: ['figma'], discipline: 'design', matchedTags: ['figma'] },
    ]);
  });
});

describe('POST /api/search/vector embedding cache', () => {
  it('embeds a repeated query once, ignoring case and spacing', async () => {
    await POST(request({ query: 'Brand  Designer' }));
    await POST(request({ query: ' brand designer ' }));

    expect(embedCalls()).toBe(1);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('embeds different queries separately', async () => {
    await POST(request({ query: 'brand designer' }));
    await POST(request({ query: 'rust engineer' }));

    expect(embedCalls()).toBe(2);
  });
});
