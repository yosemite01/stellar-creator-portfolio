/**
 * POST /api/collab/token  { roomId }
 *
 * Issues a 60 second token for the standalone collab websocket server
 * (server/realtime/collab.ts), which checks it on upgrade. The caller must be
 * signed in and be a member of the bounty behind the room: its owner, or a
 * creator whose application was accepted.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getServerSession } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import {
  COLLAB_TOKEN_TTL_SECONDS,
  collabTokenSecret,
  signCollabToken,
} from '@/server/realtime/collab-policy';

export const runtime = 'nodejs';

// Matches the doc id used by BountyScopeEditor.
const bodySchema = z.object({
  roomId: z.string().regex(/^bounty-scope-[a-z0-9]+$/),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid roomId' }, { status: 400 });
  }
  const { roomId } = parsed.data;

  const bounty = await prisma.bounty.findUnique({
    where: { id: roomId.slice('bounty-scope-'.length) },
    select: {
      creatorId: true,
      applications: { where: { applicantId: userId, status: 'ACCEPTED' }, select: { id: true } },
    },
  });
  // Same answer for "no such bounty" and "not a member" so room ids can't be probed.
  const isMember = bounty && (bounty.creatorId === userId || bounty.applications.length > 0);
  if (!isMember) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json({
    token: signCollabToken({ userId, roomId }, collabTokenSecret()),
    expiresIn: COLLAB_TOKEN_TTL_SECONDS,
  });
}
