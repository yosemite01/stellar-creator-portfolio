import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { getServerSession } = vi.hoisted(() => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/auth/auth', () => ({ getServerSession }));

const { count, createMany, findMany, findFirst, create, update, remove } = vi.hoisted(() => ({
  count: vi.fn(),
  createMany: vi.fn(),
  findMany: vi.fn(),
  findFirst: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    bountyTemplate: { count, createMany, findMany, findFirst, create, update, delete: remove },
  },
}));

import { GET, POST } from '@/app/api/bounty-templates/route';
import { PATCH, DELETE } from '@/app/api/bounty-templates/[id]/route';

const signedInAs = (id: string) => getServerSession.mockResolvedValue({ user: { id, role: 'CLIENT' } });

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  getServerSession.mockReset();
  count.mockReset().mockResolvedValue(1); // system templates already seeded, by default
  createMany.mockReset();
  findMany.mockReset().mockResolvedValue([]);
  findFirst.mockReset();
  create.mockReset();
  update.mockReset();
  remove.mockReset();
});

describe('GET /api/bounty-templates', () => {
  it('requires a session', async () => {
    getServerSession.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });

  it('seeds the static templates once, when none exist yet', async () => {
    signedInAs('client-1');
    count.mockResolvedValue(0);

    await GET();

    expect(createMany).toHaveBeenCalledTimes(1);
    const { data, skipDuplicates } = createMany.mock.calls[0][0];
    expect(skipDuplicates).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    expect(data.every((t: { createdByUserId: unknown }) => t.createdByUserId === null)).toBe(true);
  });

  it('does not re-seed when system templates already exist', async () => {
    signedInAs('client-1');
    count.mockResolvedValue(5);

    await GET();

    expect(createMany).not.toHaveBeenCalled();
  });

  it('lists system templates plus the caller\'s own', async () => {
    signedInAs('client-2');

    await GET();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ createdByUserId: null }, { createdByUserId: 'client-2' }] },
      }),
    );
  });
});

describe('POST /api/bounty-templates', () => {
  const validBody = {
    category: 'Design',
    title: 'Custom logo pack',
    description: 'A custom set of logo variants.',
    suggestedBudget: 500,
    suggestedTimeline: 7,
    requiredSkills: ['Illustrator'],
  };

  function post(body: unknown) {
    return new NextRequest('http://localhost/api/bounty-templates', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('requires a session', async () => {
    getServerSession.mockResolvedValue(null);
    expect((await POST(post(validBody))).status).toBe(401);
  });

  it('rejects an invalid payload', async () => {
    signedInAs('client-3');
    expect((await POST(post({ title: 'missing fields' }))).status).toBe(400);
  });

  it('creates the template owned by the caller', async () => {
    signedInAs('client-3');
    create.mockResolvedValue({ id: 'tpl-new', createdByUserId: 'client-3', ...validBody });

    const res = await POST(post(validBody));

    expect(res.status).toBe(201);
    expect(create).toHaveBeenCalledWith({
      data: { ...validBody, createdByUserId: 'client-3', version: 1, status: 'PENDING_REVIEW' },
    });
  });
});

describe('PATCH /api/bounty-templates/[id]', () => {
  function patch(body: unknown) {
    return new NextRequest('http://localhost/api/bounty-templates/tpl-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('returns 404 for a template the caller does not own (including system templates)', async () => {
    signedInAs('client-4');
    findFirst.mockResolvedValue(null);

    const res = await PATCH(patch({ title: 'New title' }), params('tpl-1'));

    expect(res.status).toBe(404);
    expect(findFirst).toHaveBeenCalledWith({ where: { id: 'tpl-1', createdByUserId: 'client-4' } });
    expect(update).not.toHaveBeenCalled();
  });

  it('updates a template the caller owns', async () => {
    signedInAs('client-5');
    findFirst.mockResolvedValue({ id: 'tpl-2', createdByUserId: 'client-5' });
    update.mockResolvedValue({ id: 'tpl-2', createdByUserId: 'client-5', title: 'New title' });

    const res = await PATCH(patch({ title: 'New title' }), params('tpl-2'));

    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'tpl-2' },
      data: { title: 'New title', version: 2, status: 'PENDING_REVIEW' },
    });
  });
});

describe('DELETE /api/bounty-templates/[id]', () => {
  it('returns 404 for a template the caller does not own', async () => {
    signedInAs('client-6');
    findFirst.mockResolvedValue(null);

    const res = await DELETE(new NextRequest('http://localhost/api/bounty-templates/tpl-3'), params('tpl-3'));

    expect(res.status).toBe(404);
    expect(remove).not.toHaveBeenCalled();
  });

  it('deletes a template the caller owns', async () => {
    signedInAs('client-7');
    findFirst.mockResolvedValue({ id: 'tpl-4', createdByUserId: 'client-7' });

    const res = await DELETE(new NextRequest('http://localhost/api/bounty-templates/tpl-4'), params('tpl-4'));

    expect(res.status).toBe(200);
    expect(remove).toHaveBeenCalledWith({ where: { id: 'tpl-4' } });
  });
});
