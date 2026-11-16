import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from '@/lib/auth/auth';
import { reviewTemplate } from '@/lib/services/bounty-template-service';

/**
 * POST /api/admin/bounty-templates/[id]/review
 *
 * Moderator review for custom bounty templates (Issue #1821).
 * Requires ADMIN role.
 *
 * Body: { decision: "approve" | "reject", reviewNotes?: string }
 */

const reviewSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  reviewNotes: z.string().trim().max(2000).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession();
  const user = session?.user as { id?: string; role?: string } | undefined;
  if (!user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = reviewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 400 });
  }

  const { id } = await params;
  try {
    const template = await reviewTemplate(user.id, id, parsed.data);
    return NextResponse.json({ template }, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Review failed';
    if (message.includes('not found')) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
