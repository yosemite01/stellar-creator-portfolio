import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from '@/lib/auth/auth';
import {
  deleteOwnTemplate,
  getTemplateById,
  getTemplateVersion,
  updateOwnTemplate,
} from '@/lib/services/bounty-template-service';

/**
 * GET    /api/bounty-templates/[id]   get a template or specific historical version
 * PATCH  /api/bounty-templates/[id]   update a template the caller owns (increments version)
 * DELETE /api/bounty-templates/[id]   delete a template the caller owns
 *
 * PATCH and DELETE return 404 for a system template, another user's template, or an
 * unknown id — indistinguishable on purpose, see
 * lib/services/bounty-template-service.ts (Issue #1611, Issue #1821).
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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const versionParam = req.nextUrl?.searchParams?.get('version');
  if (versionParam) {
    const version = parseInt(versionParam, 10);
    if (!isNaN(version) && version > 0) {
      const template = await getTemplateVersion(id, version);
      if (!template) {
        return NextResponse.json({ error: 'Template version not found' }, { status: 404 });
      }
      return NextResponse.json({ template });
    }
  }

  const template = await getTemplateById(id);
  if (!template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }

  return NextResponse.json({ template });
}

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

  const { id } = await params;
  const template = await updateOwnTemplate(session.user.id, id, parsed.data);
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
