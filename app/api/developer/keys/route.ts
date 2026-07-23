import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { generateApiKey, parseScopes } from '@/lib/api-keys';

export async function GET() {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const keys = await prisma.apiKey.findMany({
    where: { userId: session.user.id, revokedAt: null },
    select: {
      id: true,
      name: true,
      scopes: true,
      lastUsedAt: true,
      expiresAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ keys });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const { name, scopes, expiresAt } = body as {
    name: string;
    scopes: string[];
    expiresAt?: string;
  };

  if (!name?.trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  }

  const parsedScopes = parseScopes(scopes ?? []);
  if (parsedScopes.length === 0) {
    return NextResponse.json({ error: 'At least one valid scope is required' }, { status: 400 });
  }

  const { rawKey, keyHash } = generateApiKey();

  const key = await prisma.apiKey.create({
    data: {
      userId: session.user.id,
      keyHash,
      name: name.trim(),
      scopes: parsedScopes,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    },
    select: { id: true, name: true, scopes: true, expiresAt: true, createdAt: true },
  });

  return NextResponse.json({ key, rawKey }, { status: 201 });
}
