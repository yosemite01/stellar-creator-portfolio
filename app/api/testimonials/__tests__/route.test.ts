import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../route';

vi.mock('@/lib/db', () => ({
  prisma: {
    testimonial: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from '@/lib/db';

describe('GET /api/testimonials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns testimonials list successfully', async () => {
    (prisma.testimonial.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 't-1',
        clientId: 'c-1',
        creatorId: 'cr-1',
        author: 'Alice',
        role: 'Founder',
        quote: 'Amazing work on our design',
        rating: 5,
        featured: true,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        creator: { id: 'cr-1', creatorProfile: { displayName: 'Bob' } },
        bounty: { title: 'Logo Design' },
      },
    ]);

    const req = new NextRequest('http://localhost:3000/api/testimonials?featured=true');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.testimonials).toHaveLength(1);
    expect(data.testimonials[0].author).toBe('Alice');
  });

  it('handles database error and returns 500', async () => {
    (prisma.testimonial.findMany as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('DB failure'));

    const req = new NextRequest('http://localhost:3000/api/testimonials');
    const res = await GET(req);
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe('Internal server error');
  });
});
