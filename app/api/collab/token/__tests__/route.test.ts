import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../route';

const BOUNTY_ID = 'clh3k2q0a0000abcdefghijk';
const ROOM_ID = `bounty-scope-${BOUNTY_ID}`;
const OWNER_ID = 'clh3k2q0a0001abcdefghijk';
const APPLICANT_ID = 'clh3k2q0a0002abcdefghijk';
const OUTSIDER_ID = 'clh3k2q0a0003abcdefghijk';

vi.mock('@/lib/auth/auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    bounty: {
      findUnique: vi.fn(),
    },
  },
}));

import { getServerSession } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { collabTokenSecret, verifyCollabToken } from '@/server/realtime/collab-policy';

function asSession(id: string | null) {
  (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue(id ? { user: { id } } : null);
}

function request(body: unknown) {
  return new NextRequest('http://localhost:3000/api/collab/token', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/collab/token', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The route asks for applications by the caller, so answer like the database would.
    (prisma.bounty.findUnique as ReturnType<typeof vi.fn>).mockImplementation(async (args) => {
      const applicantId = args.select.applications.where.applicantId;
      return {
        creatorId: OWNER_ID,
        applications: applicantId === APPLICANT_ID ? [{ id: 'app-1' }] : [],
      };
    });
  });

  it('returns 401 without a session', async () => {
    asSession(null);
    const res = await POST(request({ roomId: ROOM_ID }));
    expect(res.status).toBe(401);
    expect(prisma.bounty.findUnique).not.toHaveBeenCalled();
  });

  it('returns 400 for a roomId that is not a bounty scope room', async () => {
    asSession(OWNER_ID);
    const res = await POST(request({ roomId: 'default' }));
    expect(res.status).toBe(400);
    expect(prisma.bounty.findUnique).not.toHaveBeenCalled();
  });

  it('returns 403 for a user who is not a member of the bounty', async () => {
    asSession(OUTSIDER_ID);
    const res = await POST(request({ roomId: ROOM_ID }));
    expect(res.status).toBe(403);
  });

  it('returns 403 when the bounty does not exist', async () => {
    asSession(OWNER_ID);
    (prisma.bounty.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await POST(request({ roomId: ROOM_ID }));
    expect(res.status).toBe(403);
  });

  it('issues a room-bound token to the bounty owner', async () => {
    asSession(OWNER_ID);
    const res = await POST(request({ roomId: ROOM_ID }));
    expect(res.status).toBe(200);
    const { token, expiresIn } = await res.json();
    expect(expiresIn).toBe(60);
    expect(verifyCollabToken(token, collabTokenSecret())).toMatchObject({
      userId: OWNER_ID,
      roomId: ROOM_ID,
    });
  });

  it('issues a token to a creator with an accepted application', async () => {
    asSession(APPLICANT_ID);
    const res = await POST(request({ roomId: ROOM_ID }));
    expect(res.status).toBe(200);
    expect(prisma.bounty.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          applications: expect.objectContaining({
            where: { applicantId: APPLICANT_ID, status: 'ACCEPTED' },
          }),
        }),
      }),
    );
  });
});
