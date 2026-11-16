import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth/auth';
import { listPendingTemplates } from '@/lib/services/bounty-template-service';

/**
 * GET /api/admin/bounty-templates/pending
 *
 * List templates awaiting moderation approval (Issue #1821).
 * Requires ADMIN role.
 */
export async function GET() {
  const session = await getServerSession();
  const user = session?.user as { id?: string; role?: string } | undefined;
  if (!user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
  }

  try {
    const templates = await listPendingTemplates(user.id);
    return NextResponse.json({ templates });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to list pending templates';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
