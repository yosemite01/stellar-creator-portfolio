import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from '@/lib/auth/auth';
import { deleteOwnTemplate, updateOwnTemplate } from '@/lib/services/bounty-template-service';
import { sanitizeRichText } from '@/lib/bounty-templates';

/**
 * PATCH  /api/bounty-templates/[id]   update a template the caller owns
 * DELETE /api/bounty-templates/[id]   delete a template the caller owns
 *
 * Both return 404 for a system template, another user's template, or an
 * unknown id — indistinguishable on purpose, see
 * lib/services/bounty-template-service.ts (Issue #1611).
 */

const templatePatchSchema = z
  .object({
    category: z.string().trim().min(1).max(100),
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(5000),
    suggestedBudget: z.number().int().positive(),
    suggestedTimeline: z.number().int().positive(),
    requiredSkills: z.array(z.string().trim().min(1)).max(20),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, { message: 'No fields to update' });

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = templatePatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid template', details: parsed.error.flatten() }, { status: 400 });
  }

  const input =
    parsed.data.description !== undefined
      ? { ...parsed.data, description: sanitizeRichText(parsed.data.description) }
      : parsed.data;

  const { id } = await params;
  const template = await updateOwnTemplate(session.user.id, id, input);
  if (!template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }

  return NextResponse.json({ template });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const deleted = await deleteOwnTemplate(session.user.id, id);
  if (!deleted) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }

  return NextResponse.json({ deleted: true });
}
