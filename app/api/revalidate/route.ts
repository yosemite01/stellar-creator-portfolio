import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { invalidateCacheTag } from '@/lib/cache/revalidate';
import { isAllowedCacheTag } from '@/lib/cache/tags';
import { getServerSession } from '@/lib/auth/auth';

export const runtime = 'nodejs';

const revalidateSchema = z.object({
  tag: z.string().min(1).max(100),
  secret: z.string().optional(),
});

function secretMatches(provided: string | undefined, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  const secretKey = process.env.REVALIDATION_SECRET;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = revalidateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { tag, secret } = parsed.data;

  // Protected: Requires valid authenticated session OR constant-time secret match
  const isAuthorized = secretMatches(secret, secretKey) || Boolean(session?.user?.id);

  if (!isAuthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Validate that the tag is an allowlisted static or dynamic entity cache tag
  if (!isAllowedCacheTag(tag)) {
    return NextResponse.json({ error: 'Invalid or unknown cache tag' }, { status: 422 });
  }

  const result = await invalidateCacheTag(tag);

  return NextResponse.json({
    revalidated: result.revalidated,
    tag: result.tag,
    now: Date.now(),
  });
}
