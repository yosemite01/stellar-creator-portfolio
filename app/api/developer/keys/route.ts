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
      prefix: true,
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

  let body: { name?: unknown; scopes?: unknown; expiresAt?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { name, scopes, expiresAt } = body;

  if (typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  }

  if (scopes !== undefined && !Array.isArray(scopes)) {
    return NextResponse.json({ error: 'Scopes must be an array' }, { status: 400 });
  }

  const parsedScopes = parseScopes((scopes as string[] | undefined) ?? []);
  if (parsedScopes.length === 0) {
    return NextResponse.json({ error: 'At least one valid scope is required' }, { status: 400 });
  }

  let parsedExpiresAt: Date | null = null;
  if (expiresAt !== undefined && expiresAt !== null) {
    if (typeof expiresAt !== 'string') {
      return NextResponse.json({ error: 'expiresAt must be an ISO date string' }, { status: 400 });
    }
    const date = new Date(expiresAt);
    if (Number.isNaN(date.getTime())) {
      return NextResponse.json({ error: 'expiresAt must be a valid date' }, { status: 400 });
    }
    if (date.getTime() <= Date.now()) {
      return NextResponse.json({ error: 'expiresAt must be in the future' }, { status: 400 });
    }
    parsedExpiresAt = date;
  }

  // generateApiKey applies the default TTL when no expiry was requested, so
  // every key is forced through rotation (#1541) — never store a null expiry.
  const generated = generateApiKey({
    scopes: parsedScopes,
    expiresAt: parsedExpiresAt ?? undefined,
  });
  const { rawKey, keyHash, prefix } = generated;

  const key = await prisma.apiKey.create({
    data: {
      userId: session.user.id,
      keyHash,
      prefix,
      name: name.trim(),
      scopes: generated.scopes,
      expiresAt: generated.expiresAt,
    },
    select: {
      id: true,
      name: true,
      prefix: true,
      scopes: true,
      expiresAt: true,
      createdAt: true,
    },
  });

  // The full key is returned exactly once; only the prefix + hash are stored.
  return NextResponse.json({ key, rawKey }, { status: 201 });
}
